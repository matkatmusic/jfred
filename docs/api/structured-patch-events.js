// structured-patch-events: emission of the patchContext event kind (roadmap
// item 3). For each kept authored edit of the file whose structuredPatch holds
// at least one unchanged context (' ') line, emit one patchContext event at the
// edit's coords. Kind fields are {} — the context lines are re-derived at
// materialize (the originalFile / bashTruncate convention). Mirrors
// extractOriginalFileEventsFromEdits; consumes the already-parsed structuredPatch
// read-only (the probe-reachable reconstruction parse is never touched).

var doesEditBelongToFile = require('./file-historical-lineage').doesEditBelongToFile;
var createKindEvent = require('./file-event-kinds').createKindEvent;

// ISO timestamp of the record at a parsed index, or null. A record without one
// can't join the time-keyed timeline — its edit is dropped (same guard the
// authored/originalFile extractors use). Local copy: importing recordTimestampAt
// from file-events-extractors would form a cycle (that module imports this one).
function timestampAt(parsed, index) {
  var record = parsed[index];
  if (!record) { return null; }
  return record.timestamp ? record.timestamp : null;
}

// True when some hunk carries at least one unchanged context (' ') line — the
// lines patchContext recovers. '+' added, '-' removed, and '\' "No newline"
// marker lines do not count; a missing/empty hunk array is false.
function doHunksHaveContextLine(hunks) {
  if (!Array.isArray(hunks)) { return false; }
  for (var hi = 0; hi < hunks.length; hi++) {
    var lines = Array.isArray(hunks[hi].lines) ? hunks[hi].lines : [];
    for (var li = 0; li < lines.length; li++) {
      if (lines[li].charAt(0) === ' ') { return true; }
    }
  }
  return false;
}

// The structuredPatch hunks of the record an edit points at, or null.
function getStructuredPatchForEdit(parsed, edit) {
  var record = parsed[edit.line];
  if (!record) { return null; }
  if (!record.toolUseResult) { return null; }
  return record.toolUseResult.structuredPatch;
}

// One patchContext observation from one extracted edit, or null when it does not
// belong to the file, is classified 'ignored', carries no context line, or has
// no timestamp. Kind fields are {} — content is sourced via refs at materialize.
function buildPatchContextEvent(jsonlPath, parsed, edit, statusByLine, aliasSet, aliasPaths) {
  if (!doesEditBelongToFile(edit, aliasSet, aliasPaths)) { return null; }
  if (statusByLine[edit.line + 1] === 'ignored') { return null; }
  if (!doHunksHaveContextLine(getStructuredPatchForEdit(parsed, edit))) { return null; }
  var isoTimestamp = timestampAt(parsed, edit.line);
  if (!isoTimestamp) { return null; }
  var patchEvent = createKindEvent(jsonlPath, edit.line + 1, isoTimestamp, 'patchContext', {});
  patchEvent.aliasPath = edit.filePath;
  return patchEvent;
}

// patchContext events for the kept edits of this file whose patches carry
// unchanged context lines.
function extractPatchContextEvents(jsonlPath, parsed, edits, statusByLine, aliasPaths) {
  var aliasSet = new Set(aliasPaths);
  var events = [];
  for (var i = 0; i < edits.length; i++) {
    var event = buildPatchContextEvent(jsonlPath, parsed, edits[i], statusByLine, aliasSet, aliasPaths);
    if (event) { events.push(event); }
  }
  return events;
}

module.exports = {
  extractPatchContextEvents: extractPatchContextEvents,
  doHunksHaveContextLine: doHunksHaveContextLine
};
