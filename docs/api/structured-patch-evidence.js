// structured-patch-evidence: materialization of the patchContext event kind
// (roadmap item 3). Walks the toolUseResult.structuredPatch hunks of the edit
// record an event points at and surfaces each UNCHANGED context (' ') line as a
// per-line {lineNum, text, ref} observation, numbered by its POST-edit absolute
// position (from each hunk's newStart). Lives in its own module — line-state-
// evidence is at the 250-line write cap, and it reuses that module's
// buildStructuredPatchRef, forming a require cycle broken at CALL time (mirrors
// bash-op-evidence).

var loadParsedRecord = require('./evidence-record-access').loadParsedRecord;

// line-state-evidence's materializeEventEvidence dispatches here, and this module reuses
// its buildStructuredPatchRef. Both reassign module.exports, so a LOAD-time
// require can capture a stale {}. Resolve it at CALL time (see bash-op-evidence).
function requireLineStateEvidence() { return require('./line-state-evidence'); }

// {lineNum, text, ref} for one context line at the running cursor; the ref is a
// structuredPatch locator into the hunk/line the resolver dereferences.
function buildPatchContextLineEntry(event, cursor, line, hunkIndex, lineIndex) {
  var ref = requireLineStateEvidence().buildStructuredPatchRef(event.jsonl, event.jsonlLine, 'toolUseResult.structuredPatch', hunkIndex, lineIndex);
  return { lineNum: cursor, text: line.slice(1), ref: ref };
}

// Append every context (' ') line of one hunk to byLine, numbered from
// hunk.newStart. '\' "No newline" markers and '-' removed lines are skipped
// without advancing the cursor (they are absent from the new file); '+' added
// lines advance the cursor but aren't emitted (the edit splice already authors
// them). A hunk with no numeric newStart is skipped whole — a missing
// observation is safe.
function appendHunkContext(byLine, event, hunk, hunkIndex) {
  if (typeof hunk.newStart !== 'number') { return; }
  var lines = Array.isArray(hunk.lines) ? hunk.lines : [];
  var cursor = hunk.newStart;
  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    var prefix = lines[lineIndex].charAt(0);
    if (prefix === '\\') { continue; }
    if (prefix === '-') { continue; }
    if (prefix === '+') { cursor++; continue; }
    byLine.push(buildPatchContextLineEntry(event, cursor, lines[lineIndex], hunkIndex, lineIndex));
    cursor++;
  }
}

// Per-line {lineNum, text, ref} for every unchanged context line across the
// record's hunks, at their post-edit absolute positions.
function materializePatchContextEvidence(event) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var hunks = Array.isArray(record.toolUseResult.structuredPatch) ? record.toolUseResult.structuredPatch : [];
  var byLine = [];
  for (var hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
    appendHunkContext(byLine, event, hunks[hunkIndex], hunkIndex);
  }
  return { kind: 'patchContext', byLine: byLine };
}

module.exports = {
  materializePatchContextEvidence: materializePatchContextEvidence
};
