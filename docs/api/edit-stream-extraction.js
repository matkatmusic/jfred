// edit-stream-extraction: the replay representation — the ordered edit stream
// the production probe replays. Moved (Phase 5) from common/replay-edits.js
// (extractEditsFromJSONL + helpers) and tools/reconstruct.js
// (extractKeptEditsForFile), plus the NEW extractFileModifyingEventsFromTranscript (the
// diff viewer's file tree). The four observation extractors it composes live in
// api/file-event-observations.js; bash file-ops in api/extract-bash-file-ops.js.
// Pure of console/argv; reads a path only in extractKeptEditsForFile.

// Loadable in Node (require) and the browser (classic script tag). In the
// browser the guard is skipped and these names resolve to globals defined by
// earlier-loaded scripts — api/rewind-classification.js (analyzeJSONL),
// api/file-event-observations.js (the three observation extractors), and
// api/extract-bash-file-ops.js (extractBashFileOps) — which MUST load first.
// fs and fileObs are referenced only in the Node-only extractKeptEditsForFile.
if (typeof module !== 'undefined' && typeof require === 'function') {
  var fs = require('fs');
  var analyzeJSONL = require('./rewind-classification').analyzeJSONL;
  var fileObs = require('./file-event-observations');
  var extractBashCatEdits = fileObs.extractBashCatEdits;
  var extractSnapshotEdits = fileObs.extractSnapshotEdits;
  var extractBashFileOps = require('./extract-bash-file-ops').extractBashFileOps;
  var readScanner = require('./read-event-scanner');
  var scanReadEvents = readScanner.scanReadEvents;
  var chunkEventToEditRecord = readScanner.chunkEventToEditRecord;
}

// ─── Helpers for extractEditsFromJSONL ─────────────────────────────────────

// Safely parse a single JSON line, returning the object or null.
function replayTryParse(line) {
  try { return JSON.parse(line); } catch (e) { return null; }
}

// Parse JSONL lines into objects array and extract session ID.
function replayParseLines(lines) {
  var parsed = [];
  var sessionId = '';
  for (var i = 0; i < lines.length; i++) {
    var obj = replayTryParse(lines[i]);
    parsed.push(obj);
    if (!sessionId && obj && obj.sessionId) { sessionId = obj.sessionId; }
  }
  return { parsed: parsed, sessionId: sessionId };
}

// Build a create or update edit object.
function buildCreateOrUpdateEdit(i, filePath, file, tr) {
  return { line: i, filePath: filePath, file: file, type: tr.type, content: tr.content, userModified: tr.userModified || false };
}

// Build an edit-type (oldString/newString) edit object.
function buildReplaceEdit(i, filePath, file, tr) {
  return {
    line: i, filePath: filePath, file: file, type: 'edit',
    oldString: tr.oldString !== undefined ? tr.oldString : tr.old_string,
    newString: tr.newString !== undefined ? tr.newString : tr.new_string,
    replaceAll: tr.replaceAll || tr.replace_all || false,
    originalFile: tr.originalFile || null, userModified: tr.userModified || false
  };
}

// Check if a toolUseResult is an edit-relevant operation.
function classifyToolUseResult(tr) {
  var isCreate = tr.type === 'create';
  var isUpdate = tr.type === 'update';
  var isEdit = tr.oldString !== undefined || tr.old_string !== undefined;
  return { isCreate: isCreate, isUpdate: isUpdate, isEdit: isEdit };
}

// Process a single parsed object into an edit, or return null.
function buildEditFromToolUseResult(i, tr) {
  var c = classifyToolUseResult(tr);
  if (!c.isCreate && !c.isUpdate && !c.isEdit) { return null; }
  var filePath = tr.filePath || '';
  var file = filePath.split('/').pop();
  if (c.isCreate || c.isUpdate) { return buildCreateOrUpdateEdit(i, filePath, file, tr); }
  return buildReplaceEdit(i, filePath, file, tr);
}

// Normalize one array-shaped toolUseResult element to a non-read reconstruction
// type (create/update/edit), or null. Null-safe: non-objects and nulls return
// null without throwing. Reads are NOT handled here — they require cross-record
// tool_use/tool_result pairing (file-event-observations.js), not a lone element.
function getNonReadType(el) {
  if (!el) { return null; }
  if (typeof el !== 'object') { return null; }
  if (el.type === 'create') { return 'create'; }
  if (el.type === 'update') { return 'update'; }
  if (el.oldString !== undefined) { return 'edit'; }
  if (el.old_string !== undefined) { return 'edit'; }
  if (el.type !== undefined) { return el.type; }   // 'text' / 'image' / …
  return null;
}

// Whitelist of self-contained (non-read) element types extractable from a single
// array element. Mirrors classifyToolUseResult's accept set, so a usable type
// guarantees buildEditFromToolUseResult returns non-null. 'read' is excluded by
// design (reads are paired across records, never self-contained in one element).
function isUsableNonReadReconstructionType(type) {
  if (type === 'create') { return true; }
  if (type === 'update') { return true; }
  if (type === 'edit') { return true; }
  return false;
}

// Iterate an array-shaped toolUseResult, keeping only its usable elements. The
// inner loop is lifted here so extractToolUseEdits stays ≤3-deep.
function extractNonReadEditsFromArrayToolUseResult(i, tr) {
  var out = [];
  for (var k = 0; k < tr.length; k++) {
    var t = getNonReadType(tr[k]);
    if (isUsableNonReadReconstructionType(t)) {
      out.push(buildEditFromToolUseResult(i, tr[k]));   // non-null: type matched classify
    }
  }
  return out;
}

// Extract create/update/edit operations from parsed JSONL objects.
function extractToolUseEdits(parsed) {
  var edits = [];
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    if (!parsed[i].toolUseResult) { continue; }
    var tr = parsed[i].toolUseResult;
    if (Array.isArray(tr)) {
      Array.prototype.push.apply(edits, extractNonReadEditsFromArrayToolUseResult(i, tr));
      continue;
    }
    var edit = buildEditFromToolUseResult(i, tr);
    if (edit) { edits.push(edit); }
  }
  return edits;
}

// Collect the set of filenames that have Write/Edit (create or edit) entries.
function collectWrittenFileNames(edits) {
  var writtenFiles = {};
  for (var i = 0; i < edits.length; i++) {
    var etype = edits[i].type;
    if (etype === 'create' || etype === 'edit') { writtenFiles[edits[i].file] = true; }
  }
  return writtenFiles;
}

// Append read edits that correspond to written files. The unified read scanner
// yields one superset record per Read; chunkEventToEditRecord derives the legacy
// edit shape (null when the legacy scanner would have dropped it).
function appendFilteredReadEdits(edits, lines, parsed, writtenFiles) {
  var records = scanReadEvents(lines, parsed);
  for (var r = 0; r < records.length; r++) {
    var readEdit = chunkEventToEditRecord(records[r]);
    if (!readEdit) { continue; }
    if (writtenFiles[readEdit.file]) { edits.push(readEdit); }
  }
}

// Merge cat, read, and snapshot edits into the main edit array.
function mergeExternalEdits(edits, lines, parsed, sessionId, writtenFiles) {
  var catEdits = extractBashCatEdits(lines, parsed);
  for (var c = 0; c < catEdits.length; c++) { edits.push(catEdits[c]); }
  appendFilteredReadEdits(edits, lines, parsed, writtenFiles);
  var snapshotEdits = extractSnapshotEdits(lines, parsed, sessionId);
  for (var s = 0; s < snapshotEdits.length; s++) { edits.push(snapshotEdits[s]); }
  if (extractBashFileOps) {
    var fileOps = extractBashFileOps(parsed);
    for (var f = 0; f < fileOps.length; f++) { edits.push(fileOps[f]); }
  }
}

// Extract edit operations from JSONL text. Returns an ordered array of edit objects.
function extractEditsFromJSONL(jsonlText) {
  var lines = jsonlText.split('\n').filter(Boolean);
  var result = replayParseLines(lines);
  var edits = extractToolUseEdits(result.parsed);
  var writtenFiles = collectWrittenFileNames(edits);
  mergeExternalEdits(edits, lines, result.parsed, result.sessionId, writtenFiles);
  edits.sort(function (a, b) { return a.line - b.line; });
  return edits;
}

// ─── extractKeptEditsForFile (from tools/reconstruct.js) ────────────────────

// Build a status lookup (1-based line -> kept/ignored) from classification edits.
function buildStatusLookup(classification) {
  var statusByLine = {};
  for (var c = 0; c < classification.edits.length; c++) {
    statusByLine[classification.edits[c].line] = classification.edits[c].status;
  }
  return statusByLine;
}

// Filter edits for a target file into kept/ignored buckets.
function filterEditsForFile(allEdits, statusByLine, targetFile) {
  var kept = [];
  var ignored = 0;
  for (var i = 0; i < allEdits.length; i++) {
    if (allEdits[i].file !== targetFile) {
      continue;
    }
    if (statusByLine[allEdits[i].line + 1] === 'ignored') {
      ignored++;
    } else {
      kept.push(allEdits[i]);
    }
  }
  return { kept: kept, ignored: ignored, total: kept.length + ignored };
}

// Load JSONL, classify, and return {kept, ignored, total} for one target file.
function extractKeptEditsForFile(jsonlPath, targetFile) {
  var text = fs.readFileSync(jsonlPath, 'utf8');
  var allEdits = extractEditsFromJSONL(text);
  var classification = analyzeJSONL(text);
  var statusByLine = buildStatusLookup(classification);
  return filterEditsForFile(allEdits, statusByLine, targetFile);
}

// ─── extractFileModifyingEventsFromTranscript (diff viewer's file tree) ──────────────

// Group every extracted edit by its file path. The edit-representation twin of
// the sidecar event extractor; mirrors common/jfred-load-helpers.groupEditsByFile
// over extractEditsFromJSONL's output. The diff viewer repoints onto this (phase 7).
function groupEditsByFile(edits) {
  var map = {};
  for (var i = 0; i < edits.length; i++) {
    var fp = edits[i].filePath || edits[i].file || '';
    if (!fp) { continue; }
    if (!map[fp]) { map[fp] = []; }
    map[fp].push(edits[i]);
  }
  return map;
}

// Every file modified in one transcript, grouped by file path.
function extractFileModifyingEventsFromTranscript(jsonlText) {
  return groupEditsByFile(extractEditsFromJSONL(jsonlText));
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractEditsFromJSONL: extractEditsFromJSONL,
    extractKeptEditsForFile: extractKeptEditsForFile,
    extractFileModifyingEventsFromTranscript: extractFileModifyingEventsFromTranscript,
    getNonReadType: getNonReadType,
    isUsableNonReadReconstructionType: isUsableNonReadReconstructionType
  };
}
