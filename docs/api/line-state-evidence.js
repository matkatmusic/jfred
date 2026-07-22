// line-state-evidence: evidence-reference construction + event materialization
// for the per-line state tracker. Every claim the tracker makes must point at
// a JSONL line (or blob) — these helpers compute the per-line text the tracker
// works on IN MEMORY, paired with the evidenceRef that proves it:
//   { jsonl, jsonlLine, textProperty|structuredPatch|blobFile (exactly one) }.

var fs = require('fs');
var path = require('path');
var recordAccess = require('./evidence-record-access');
var loadParsedRecord = recordAccess.loadParsedRecord;
var findToolResultText = recordAccess.findToolResultText;
var findStructuredPatchLine = recordAccess.findStructuredPatchLine;
var numbered = require('./numbered-entries');

// Numbered Read-result content line: "N\tcontent".
var READ_NUMBER_PATTERN = /^(\d+)\t/;
// cat -n style prefixes: " 1 │ content" or "  1\tcontent".
var CAT_NUMBER_PATTERN = /^\s*(\d+)\s*(?:│ ?|\t)/;

// ─── Content line splitting ─────────────────────────────────────────────────

// File content as lines: a trailing newline is a terminator, not an extra
// empty line; interior blank lines survive; '' is a zero-line file.
function splitContentIntoLineSpans(text) {
  if (text === '') { return []; }
  var parts = text.split('\n');
  if (text.endsWith('\n')) { parts.pop(); }
  return parts;
}

// Substring bounds of each splitContentIntoLineSpans line within text (end exclusive).
function computeContentLineSpans(text) {
  var lines = splitContentIntoLineSpans(text);
  var spans = [];
  var offset = 0;
  for (var i = 0; i < lines.length; i++) {
    spans.push({ startIndex: offset, endIndex: offset + lines[i].length });
    offset += lines[i].length + 1;
  }
  return spans;
}

// ─── Numbered result parsing ────────────────────────────────────────────────

// Read results carry ABSOLUTE file line numbers in their prefixes; the Read
// tool's terminal numbered-empty phantom (one per file ending in a single '\n')
// is dropped so belief EOF matches the real file (see numbered-entries).
function buildNumberedLineEntries(rawText) {
  return numbered.dropTrailingReadPhantom(numbered.buildNumberedEntries(rawText, READ_NUMBER_PATTERN), rawText);
}

// Entries for plain (un-numbered) whole-file text, numbered from 1.
function buildPlainLineEntries(rawText) {
  var lines = splitContentIntoLineSpans(rawText);
  return computeContentLineSpans(rawText).map(function (span, i) {
    return { lineNum: i + 1, text: lines[i], startIndex: span.startIndex, endIndex: span.endIndex };
  });
}

// First non-empty line of a string, or ''.
function findFirstNonEmptyLine(rawText) {
  var lines = rawText.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) { return lines[i]; }
  }
  return '';
}

// cat stdout: numbered when cat -n prefixes are present, else whole from 1.
function buildCatLineEntries(rawText) {
  if (CAT_NUMBER_PATTERN.test(findFirstNonEmptyLine(rawText))) { return numbered.buildNumberedEntries(rawText, CAT_NUMBER_PATTERN); }
  return buildPlainLineEntries(rawText);
}

// ─── evidenceRef builders ───────────────────────────────────────────────────

// An evidenceRef has exactly one non-null locator sub-object.
function buildRefWithLocator(jsonl, jsonlLine, locatorName, locator) {
  var ref = { jsonl: jsonl, jsonlLine: jsonlLine, textProperty: null, structuredPatch: null, blobFile: null };
  ref[locatorName] = locator;
  return ref;
}

function buildTextPropertyRef(jsonl, jsonlLine, property, startIndex, endIndex) {
  return buildRefWithLocator(jsonl, jsonlLine, 'textProperty', { property: property, startIndex: startIndex, endIndex: endIndex });
}

function buildStructuredPatchRef(jsonl, jsonlLine, property, hunkIndex, lineIndex) {
  return buildRefWithLocator(jsonl, jsonlLine, 'structuredPatch', { property: property, hunkIndex: hunkIndex, lineIndex: lineIndex });
}

function buildBlobFileRef(jsonl, jsonlLine, property, blobPath, startIndex, endIndex) {
  return buildRefWithLocator(jsonl, jsonlLine, 'blobFile', { property: property, path: blobPath, startIndex: startIndex, endIndex: endIndex });
}

// ─── Per-kind materialization ───────────────────────────────────────────────

// Per-line {text, ref} pairs for whole-content text; makeRefForSpan builds
// the kind-appropriate evidenceRef from each line's span.
function pairContentLines(text, makeRefForSpan) {
  var lines = splitContentIntoLineSpans(text);
  return computeContentLineSpans(text).map(function (span, i) {
    return { text: lines[i], ref: makeRefForSpan(span) };
  });
}

// byLine entries {lineNum, text, ref} from numbered/plain entries.
function pairEntriesWithReferences(event, property, entries) {
  return entries.map(function (entry) {
    var ref = buildTextPropertyRef(event.jsonl, event.jsonlLine, property, entry.startIndex, entry.endIndex);
    return { lineNum: entry.lineNum, text: entry.text, ref: ref };
  });
}

function materializeWriteEvidence(event) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var lines = pairContentLines(record.toolUseResult.content, function (span) {
    return buildTextPropertyRef(event.jsonl, event.jsonlLine, 'toolUseResult.content', span.startIndex, span.endIndex);
  });
  return { kind: 'write', lines: lines };
}

// The trackedFileBackups key naming this blob (record -> blob provenance).
function findBackupKeyForBlob(record, blobPath) {
  var backups = record.snapshot.trackedFileBackups;
  var keys = Object.keys(backups);
  for (var k = 0; k < keys.length; k++) {
    if (!backups[keys[k]]) { continue; }
    if (backups[keys[k]].backupFileName === path.basename(blobPath)) { return keys[k]; }
  }
  return null;
}

function materializeSnapshotEvidence(event) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var blobPath = event.snapshot.blob;
  var property = "snapshot.trackedFileBackups['" + findBackupKeyForBlob(record, blobPath) + "']";
  var lines = pairContentLines(fs.readFileSync(blobPath, 'utf8'), function (span) {
    return buildBlobFileRef(event.jsonl, event.jsonlLine, property, blobPath, span.startIndex, span.endIndex);
  });
  return { kind: 'snapshot', lines: lines };
}

// Splice inputs of an edit record (snake/camel both seen in the wild).
function materializeEditEvidence(event) {
  var tr = loadParsedRecord(event.jsonl, event.jsonlLine).toolUseResult;
  var oldString = tr.oldString !== undefined ? tr.oldString : tr.old_string;
  var newString = tr.newString !== undefined ? tr.newString : tr.new_string;
  var replaceAll = tr.replaceAll ? true : Boolean(tr.replace_all);
  return { kind: 'edit', oldString: oldString, newString: newString, replaceAll: replaceAll, floating: event.edit.floating };
}

// byLine entries with refs for read results / cat captures.
function materializeByLineKind(event, kindName, entriesFromText) {
  var result = findToolResultText(loadParsedRecord(event.jsonl, event.jsonlLine));
  return { kind: kindName, byLine: pairEntriesWithReferences(event, result.property, entriesFromText(result.text)) };
}

// Whole-file pre-edit observation: derefs toolUseResult.originalFile into
// per-line entries numbered from 1, each ref a span into that property.
function materializeOriginalFileEvidence(event) {
  var text = loadParsedRecord(event.jsonl, event.jsonlLine).toolUseResult.originalFile;
  return { kind: 'originalFile', byLine: pairEntriesWithReferences(event, 'toolUseResult.originalFile', buildPlainLineEntries(text)) };
}

// Contentless out-of-band-change diagnostic (item 18): NO byLine. Produces the
// diagnostic excerpt + an evidence ref into the authored payload (the proof this
// record carried the flag). The anchor differs by record kind: Edit records carry
// toolUseResult.newString; create/update/Write carry toolUseResult.content.
function materializeUserModifiedEvidence(event) {
    var tr = loadParsedRecord(event.jsonl, event.jsonlLine).toolUseResult;
    var newString = tr.newString !== undefined ? tr.newString : tr.new_string;
    var hasNewString = typeof newString === 'string';
    var content = typeof tr.content === 'string' ? tr.content : '';
    var observedText = hasNewString ? newString : content;
    var property = hasNewString ? 'toolUseResult.newString' : 'toolUseResult.content';
    var ref = buildTextPropertyRef(event.jsonl, event.jsonlLine, property, 0, observedText.length);
    return { kind: 'userModified', observedText: observedText, ref: ref };
}

// In-memory text + refs for one event, by its non-null kind sub-object. The
// bash-op materializers live in a sibling module that reuses helpers from here,
// so we require it at CALL time to break the load-time cycle (see bash-op-evidence).
function materializeEventEvidence(event) {
  if (event.write) { return materializeWriteEvidence(event); }
  if (event.snapshot) { return materializeSnapshotEvidence(event); }
  if (event.fileAbsent) { return { kind: 'fileAbsent' }; }
  if (event.edit) { return materializeEditEvidence(event); }
  if (event.readFull) { return materializeByLineKind(event, 'readFull', buildNumberedLineEntries); }
  if (event.readChunk) { return materializeByLineKind(event, 'readChunk', buildNumberedLineEntries); }
  if (event.cat) { return materializeByLineKind(event, 'cat', buildCatLineEntries); }
  if (event.originalFile) { return materializeOriginalFileEvidence(event); }
  if (event.userModified) { return materializeUserModifiedEvidence(event); }
  if (event.bashRm) { return require('./bash-op-evidence').materializeBashRmEvidence(event); }
  if (event.bashTruncate) { return require('./bash-op-evidence').materializeBashTruncateEvidence(event); }
  if (event.bashAppend) { return require('./bash-op-evidence').materializeBashAppendEvidence(event); }
  if (event.patchContext) { return require('./structured-patch-evidence').materializePatchContextEvidence(event); }
  if (event.bashReadChunk) { return require('./bash-read-evidence').materializeBashReadChunkEvidence(event); }
  if (event.bashExtent) { return require('./bash-read-evidence').materializeBashExtentEvidence(event); }
  if (event.bashGrep) { return require('./bash-read-evidence').materializeBashGrepEvidence(event); }
  if (event.grepMatches) { return require('./grep-tool-evidence').materializeGrepMatchEvidence(event); }
  return null;
}

// Evidence for a line AUTHORED by an edit: its structuredPatch location when
// the patch holds it verbatim; else a substring span into newString (boundary
// lines merge edit bytes with pre-existing bytes and may only partially
// match); null when neither locates it.
function buildRefForAuthoredEditLine(event, lineText) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var patchLocation = findStructuredPatchLine(record, lineText);
  if (patchLocation) {
    return buildStructuredPatchRef(event.jsonl, event.jsonlLine, 'toolUseResult.structuredPatch', patchLocation.hunkIndex, patchLocation.lineIndex);
  }
  var tr = record.toolUseResult;
  var newString = tr.newString !== undefined ? tr.newString : tr.new_string;
  if (typeof newString !== 'string') { return null; }
  var idx = newString.indexOf(lineText);
  if (idx < 0) { return null; }
  return buildTextPropertyRef(event.jsonl, event.jsonlLine, 'toolUseResult.newString', idx, idx + lineText.length);
}

// Short human-readable rendering of a line for report excerpts.
function makeExcerpt(text) {
  if (typeof text !== 'string') { return null; }
  if (text.length <= 80) { return text; }
  return text.slice(0, 77) + '...';
}

module.exports = {
  splitContentIntoLineSpans: splitContentIntoLineSpans,
  computeContentLineSpans: computeContentLineSpans,
  buildNumberedLineEntries: buildNumberedLineEntries,
  buildPlainLineEntries: buildPlainLineEntries,
  pairEntriesWithReferences: pairEntriesWithReferences,
  buildCatLineEntries: buildCatLineEntries,
  buildTextPropertyRef: buildTextPropertyRef,
  buildStructuredPatchRef: buildStructuredPatchRef,
  buildBlobFileRef: buildBlobFileRef,
  materializeEventEvidence: materializeEventEvidence,
  buildRefForAuthoredEditLine: buildRefForAuthoredEditLine,
  makeExcerpt: makeExcerpt
};
