// file-event-kinds: the canonical event-schema core for the sidecar event
// representation. Every event is { jsonl, jsonlLine, unixMs, timestamp } plus
// EXACTLY ONE non-null kind sub-object drawn from KIND_NAMES — the non-null
// sub-object IS the kind (there is no separate kind string). This is the one
// home every kind registers in; the extractors (file-events-extractors,
// snapshot-events) build events through createKindEvent so they share a single
// definition and avoid a require cycle between them.

// The kind sub-object names, in canonical order. snapshot/fileAbsent/write are
// Tier-1 beacons; readFull/readChunk/cat are read observations; edit is an
// authored splice; originalFile is a whole-file pre-edit observation (the
// entire file as it was the instant before an Edit's splice). bashRm/bashTruncate/
// bashAppend are Tier-2 observations from Bash file ops (rm / `>` / `>>`).
// patchContext is a Tier-2 sparse-overlay observation of the unchanged context
// (' ') lines inside an edit's structuredPatch hunks (post-edit positions).
// bashReadChunk is a Tier-2 overlay observation from a partial-content Bash read
// (head / sed -n / tail -n +N) — a contiguous line range witnessed at a known
// instant, numbered from its firstLine. bashExtent is a Tier-2 lower-bound extent
// observation from `wc -l` (implies lines 1..N exist; never proves EOF). bashGrep
// is a Tier-2 sparse overlay from single-file `grep -n` (explicit per-line matches).
// grepMatches is a Tier-2 sparse overlay from the native Grep tool (output_mode
// "content", -n) — line-addressed matches across many files, one event per matched file.
// userModified is a CONTENTLESS Tier-2 diagnostic from an Edit/Write whose
// toolUseResult.userModified flag marks an out-of-band change around the edit; it
// carries no line content (kind sub-object {}) — it records a conflict and un-proves EOF.
// scriptExecution is a TRANSFORM event (not a content observation): the recorded run
// of a Bash/MCP-sandbox script that rewrote tracked files. Its kind sub-object carries
// a transform spec (e.g. whole-token rename subs) applied at REPLAY time against the
// live per-line belief — it cannot be pre-materialized into per-line content events.
var KIND_NAMES = ['snapshot', 'fileAbsent', 'write', 'edit', 'readFull', 'readChunk', 'cat', 'originalFile', 'bashRm', 'bashTruncate', 'bashAppend', 'patchContext', 'bashReadChunk', 'bashExtent', 'bashGrep', 'grepMatches', 'userModified', 'scriptExecution'];

// An event with all kind sub-objects null except kindName (set to kindFields).
function createKindEvent(jsonlPath, jsonlLine, isoTimestamp, kindName, kindFields) {
  var event = {
    jsonl: jsonlPath,
    jsonlLine: jsonlLine,
    unixMs: Date.parse(isoTimestamp),
    timestamp: isoTimestamp
  };
  for (var i = 0; i < KIND_NAMES.length; i++) { event[KIND_NAMES[i]] = null; }
  event[kindName] = kindFields;
  return event;
}

// True when the event's non-null kind is one of kindNames.
function doesEventHaveAnyKind(event, kindNames) {
  for (var i = 0; i < kindNames.length; i++) {
    if (event[kindNames[i]] !== null) { return true; }
  }
  return false;
}

module.exports = {
  KIND_NAMES: KIND_NAMES,
  createKindEvent: createKindEvent,
  doesEventHaveAnyKind: doesEventHaveAnyKind
};
