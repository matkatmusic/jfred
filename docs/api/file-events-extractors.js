// file-events-extractors: per-file event extraction with timestamps (the
// sidecar event representation). Turns ONE transcript into schema-shaped events:
//   { jsonl, jsonlLine, unixMs, timestamp } plus EXACTLY ONE non-null kind
//   sub-object: snapshot | fileAbsent | write | edit | readFull | readChunk | cat.
// The non-null sub-object IS the kind — there is no separate kind string.
// Moved (Phase 4) from tools/extract-file-events.js; the observation extractors
// it composes now live in api/file-event-observations.js and
// api/split-read-assembly.js. extractEditsFromJSONL comes from
// api/edit-stream-extraction (Phase 5 home).

var fs = require('fs');
var logTrace = require('./trace-log').logTrace;
var extractEditsFromJSONL = require('./edit-stream-extraction').extractEditsFromJSONL;
var analyzeJSONL = require('./rewind-classification').analyzeJSONL;
var extractBashCatEdits = require('./file-event-observations').extractBashCatEdits;
var scanReadEvents = require('./read-event-scanner').scanReadEvents;
var chunkEventToReadEvent = require('./read-event-scanner').chunkEventToReadEvent;
var doesEditBelongToFile = require('./file-historical-lineage').doesEditBelongToFile;
var fileEventKinds = require('./file-event-kinds');
var createKindEvent = fileEventKinds.createKindEvent;
var snapshotEvents = require('./snapshot-events');
var extractSnapshotEventsForFile = snapshotEvents.extractSnapshotEventsForFile;
var getDefaultSnapshotsBase = snapshotEvents.getDefaultSnapshotsBase;
var extractBashOpEvents = require('./bash-op-events').extractBashOpEvents;
var extractScriptExecutionEvents = require('./script-execution-events').extractScriptExecutionEvents;
var extractPatchContextEvents = require('./structured-patch-events').extractPatchContextEvents;
var extractBashReadEvents = require('./bash-read-events').extractBashReadEvents;
var grepMatchEventsForFile = require('./grep-tool-events').grepMatchEventsForFile;
var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
var resolveAgainstCwd = require('./file-historical-lineage').resolveAgainstCwd;

// The harness caps an offset/limit-less Read at 2000 lines, so a result of
// exactly 2000 lines proves NOTHING about the tail (the EOF lesson: a
// gap-free read can still be a truncated prefix).
var DEFAULT_READ_LINE_CAP = 2000;

// ─── Transcript parsing ─────────────────────────────────────────────────────

var recordUtils = require('./file-events-record-utils');
var parseRecords = recordUtils.parseRecords;
var findSessionId = recordUtils.findSessionId;
var getTimestampAtRecord = recordUtils.getTimestampAtRecord;

// ─── Authored events (write / edit) ─────────────────────────────────────────

// statusByLine map (1-based line -> status) from analyzeJSONL's edits.
function buildStatusByLine(classifiedEdits) {
  var statusByLine = {};
  for (var i = 0; i < classifiedEdits.length; i++) {
    statusByLine[classifiedEdits[i].line] = classifiedEdits[i].status;
  }
  return statusByLine;
}

// 'write' | 'edit' for an authored edit, null for observations (read/cat/
// snapshot sourced) and bash-op records.
function classifyAuthoredKindForEdit(edit) {
  if (edit.source) { return null; }
  if (edit.type === 'create') { return 'write'; }
  if (edit.type === 'update') { return 'write'; }
  if (edit.type === 'edit') { return 'edit'; }
  return null;
}

// One authored event from one extracted edit, or null when it is not an
// authored kept edit of this file. Only success-confirmed writes exist as
// toolUseResult records at all, so reaching here IS the success confirmation.
function buildAuthoredEvent(jsonlPath, parsed, edit, statusByLine, aliasSet, aliasPaths) {
  var kind = classifyAuthoredKindForEdit(edit);
  if (!kind) { return null; }
  // Not the target file — irrelevant to this reconstruction, stay silent.
  if (!doesEditBelongToFile(edit, aliasSet, aliasPaths)) { return null; }
  // From here the edit IS for the target file, so its keep/exclude decision is
  // exactly what an --only trace wants to explain.
  var transcript = jsonlPath.split('/').pop();
  if (statusByLine[edit.line + 1] === 'ignored') {
    logTrace('    EXCLUDED ' + kind + ' edit at ' + transcript + ' JSONL line ' + (edit.line + 1) +
      ' — statusByLine=ignored (rewound / superseded; dropped from reconstruction)');
    return null;
  }
  var isoTimestamp = getTimestampAtRecord(parsed, edit.line);
  if (!isoTimestamp) {
    logTrace('    EXCLUDED ' + kind + ' edit at ' + transcript + ' JSONL line ' + (edit.line + 1) +
      ' — record carries no timestamp (cannot join the timeline)');
    return null;
  }
  // floating starts false; the TRACKER flips it when old_string cannot be
  // located in currently known content.
  var kindFields = kind === 'edit' ? { floating: false } : {};
  var authoredEvent = createKindEvent(jsonlPath, edit.line + 1, isoTimestamp, kind, kindFields);
  authoredEvent.aliasPath = edit.filePath;
  logTrace('    KEPT ' + kind + ' event at ' + transcript + ' JSONL line ' + (edit.line + 1) +
    ' @ ' + isoTimestamp);
  return authoredEvent;
}

// Write/edit events for the kept (non-rewound) edits of this file.
function extractAuthoredEvents(jsonlPath, parsed, edits, statusByLine, aliasPaths) {
  var aliasSet = new Set(aliasPaths);
  var events = [];
  for (var i = 0; i < edits.length; i++) {
    var event = buildAuthoredEvent(jsonlPath, parsed, edits[i], statusByLine, aliasSet, aliasPaths);
    if (event) { events.push(event); }
  }
  return events;
}

// ─── originalFile events (whole-file pre-edit observation) ───────────────────

// One originalFile observation from one extracted edit, or null. The edit
// carries the ENTIRE pre-edit file in .originalFile; surfacing it as a
// whole-file observation at the edit's instant pins belief and exposes drift.
// Kind fields are {} — content is sourced via refs at materialization.
function buildOriginalFileEvent(jsonlPath, parsed, edit, statusByLine, aliasSet, aliasPaths) {
  if (edit.type !== 'edit') { return null; }
  if (typeof edit.originalFile !== 'string') { return null; }
  if (edit.originalFile === '') { return null; }
  if (!doesEditBelongToFile(edit, aliasSet, aliasPaths)) { return null; }
  if (statusByLine[edit.line + 1] === 'ignored') { return null; }
  var isoTimestamp = getTimestampAtRecord(parsed, edit.line);
  if (!isoTimestamp) { return null; }
  var originalFileEvent = createKindEvent(jsonlPath, edit.line + 1, isoTimestamp, 'originalFile', {});
  originalFileEvent.aliasPath = edit.filePath;
  return originalFileEvent;
}

// originalFile events for the kept edits of this file that carry pre-edit content.
function extractOriginalFileEventsFromEdits(jsonlPath, parsed, edits, statusByLine, aliasPaths) {
  var aliasSet = new Set(aliasPaths);
  var events = [];
  for (var i = 0; i < edits.length; i++) {
    var event = buildOriginalFileEvent(jsonlPath, parsed, edits[i], statusByLine, aliasSet, aliasPaths);
    if (event) { events.push(event); }
  }
  return events;
}

// ─── Read events (readFull / readChunk) ─────────────────────────────────────

// True when the read PROVED it saw end-of-file: it returned fewer lines than
// it asked for (or than the harness default cap when it asked for nothing).
function readProvedEof(lineCount, requestedLimit) {
  if (requestedLimit === null) { return lineCount < DEFAULT_READ_LINE_CAP; }
  return lineCount < requestedLimit;
}

// readFull only for a read that started at line 1 AND proved EOF; anything
// weaker is a readChunk overlay with explicit geometry.
function buildReadKindEvent(jsonlPath, readEvent) {
  var lineCount = readEvent.contentLines.length;
  var provedEof = readProvedEof(lineCount, readEvent.requestedLimit);
  if (readEvent.firstLineNumber === 1) {
    if (provedEof) {
      return createKindEvent(jsonlPath, readEvent.jsonlLine, readEvent.timestamp, 'readFull', {});
    }
  }
  var chunk = { firstLine: readEvent.firstLineNumber, lineCount: lineCount, hitEof: provedEof };
  return createKindEvent(jsonlPath, readEvent.jsonlLine, readEvent.timestamp, 'readChunk', chunk);
}

// readFull/readChunk events for every aliased Read with a timestamp (unified scan).
function readEventsForFile(jsonlPath, lines, parsed, aliasSet) {
  var records = scanReadEvents(lines, parsed);
  var events = [];
  for (var i = 0; i < records.length; i++) {
    var readEvent = chunkEventToReadEvent(records[i]);
    if (!readEvent) { continue; }
    if (!aliasSet.has(readEvent.filePath)) { continue; }
    if (!readEvent.timestamp) { continue; }
    var kindEvent = buildReadKindEvent(jsonlPath, readEvent);
    kindEvent.aliasPath = readEvent.filePath;
    events.push(kindEvent);
  }
  return events;
}

// ─── Cat events ─────────────────────────────────────────────────────────────

// cat events for every Bash cat capture of this file. The raw cat path may be relative, so
// resolve it against the session cwd before the alias test (File-path-handling convention).
function extractCatEvents(jsonlPath, jsonlText, parsed, aliasSet) {
  var cwd = extractSessionMetadata(jsonlText).cwd;
  var catEdits = extractBashCatEdits(jsonlText.split('\n'), parsed);
  var events = [];
  for (var i = 0; i < catEdits.length; i++) {
    var resolved = resolveAgainstCwd(cwd, catEdits[i].filePath);
    if (!aliasSet.has(resolved)) { continue; }
    var isoTimestamp = getTimestampAtRecord(parsed, catEdits[i].line);
    if (!isoTimestamp) { continue; }
    var catEvent = createKindEvent(jsonlPath, catEdits[i].line + 1, isoTimestamp, 'cat', {});
    catEvent.aliasPath = resolved;
    events.push(catEvent);
  }
  return events;
}

// ─── Public API ─────────────────────────────────────────────────────────────

function compareByJsonlLineIndex(a, b) {
  return a.jsonlLine - b.jsonlLine;
}

// All events of one transcript that touch the file (any alias path), in
// transcript order. jsonlPath is the label stamped on each event's `jsonl`.
function extractFileEventsFromText(jsonlText, jsonlPath, aliasPaths, snapshotsDir) {
  var lines = jsonlText.split('\n').filter(Boolean);
  var parsed = parseRecords(lines);
  var aliasSet = new Set(aliasPaths);
  var statusByLine = buildStatusByLine(analyzeJSONL(jsonlText).edits);
  var edits = extractEditsFromJSONL(jsonlText);
  var events = extractAuthoredEvents(jsonlPath, parsed, edits, statusByLine, aliasPaths);
  Array.prototype.push.apply(events, extractOriginalFileEventsFromEdits(jsonlPath, parsed, edits, statusByLine, aliasPaths).concat(require('./user-modified-events').extractUserModifiedEventsFromEdits(jsonlPath, parsed, edits, statusByLine, aliasPaths)));
  Array.prototype.push.apply(events, extractPatchContextEvents(jsonlPath, parsed, edits, statusByLine, aliasPaths));
  Array.prototype.push.apply(events, extractBashOpEvents(jsonlPath, jsonlText, parsed, aliasSet));
  Array.prototype.push.apply(events, extractScriptExecutionEvents(jsonlPath, jsonlText, parsed, aliasSet));
  Array.prototype.push.apply(events, extractBashReadEvents(jsonlPath, jsonlText, parsed, aliasSet));
  Array.prototype.push.apply(events, grepMatchEventsForFile(jsonlPath, jsonlText, parsed, aliasSet));
  Array.prototype.push.apply(events, readEventsForFile(jsonlPath, lines, parsed, aliasSet));
  Array.prototype.push.apply(events, extractCatEvents(jsonlPath, jsonlText, parsed, aliasSet));
  var snapshotContext = {
    aliasSet: aliasSet,
    aliasPaths: aliasPaths,
    sessionId: findSessionId(parsed),
    snapshotsBase: snapshotsDir ? snapshotsDir : getDefaultSnapshotsBase()
  };
  Array.prototype.push.apply(events, extractSnapshotEventsForFile(jsonlPath, parsed, snapshotContext));
  events.sort(compareByJsonlLineIndex);
  return events;
}

function extractFileEvents(jsonlPath, aliasPaths, snapshotsDir) {
  var jsonlText = fs.readFileSync(jsonlPath, 'utf8');
  return extractFileEventsFromText(jsonlText, jsonlPath, aliasPaths, snapshotsDir);
}

module.exports = {
  extractFileEvents: extractFileEvents,
  extractFileEventsFromText: extractFileEventsFromText,
  extractAuthoredEvents: extractAuthoredEvents,
  extractOriginalFileEventsFromEdits: extractOriginalFileEventsFromEdits,
  extractCatEvents: extractCatEvents,
  readProvedEof: readProvedEof
};
