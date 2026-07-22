// line-belief: the per-line state tracker's IN-MEMORY belief model.
// A belief holds one entry per known-about line:
//   { state, confirmedAtMs, numberingCertain, evidence, text }
// where text lives only in memory (the persisted timeline carries evidence
// references, never text). Beacons collapse belief to full truth; overlays
// (reads/cats) corroborate or contradict it; contradictions surface as
// conflict info for the tracker to wrap into schema conflict records.

function createBelief() {
  return { entries: {}, lastLine: 0, eofConfirmed: false, lastBeaconMs: null };
}

// A line we know EXISTS (geometry implies it) but know nothing about.
function makeUnknownEntry() {
  return { state: 'unknown', confirmedAtMs: null, numberingCertain: true, evidence: null, text: null };
}

// A line we have content + proof for, in the given epistemic state.
function makeClaimEntry(state, unixMs, evidence, text) {
  return { state: state, confirmedAtMs: unixMs, numberingCertain: true, evidence: evidence, text: text };
}

// Observation geometry implies lines 1..throughLineNum exist — create
// unknown entries for any we have never heard of.
function ensureImpliedLines(belief, throughLineNum) {
  for (var n = 1; n <= throughLineNum; n++) {
    if (!belief.entries[n]) { belief.entries[n] = makeUnknownEntry(); }
  }
  if (throughLineNum > belief.lastLine) { belief.lastLine = throughLineNum; }
}

// Contiguous runs of lines with known text: [{startLine, texts}]. These are
// the only spans an edit's old_string can be located in.
function extractKnownRuns(belief) {
  var lineNums = Object.keys(belief.entries).map(Number).sort(function (a, b) { return a - b; });
  var runs = [];
  var current = null;
  for (var i = 0; i < lineNums.length; i++) {
    var entry = belief.entries[lineNums[i]];
    if (entry.text === null) { current = null; continue; }
    var extendsCurrent = current !== null ? lineNums[i] === current.startLine + current.texts.length : false;
    if (!extendsCurrent) {
      current = { startLine: lineNums[i], texts: [] };
      runs.push(current);
    }
    current.texts.push(entry.text);
  }
  return runs;
}

// Conflict info when an existing claim disagrees with an observation, else
// null (no entry, no claim, or agreement).
function conflictAgainstExisting(existing, lineNum, text, ref) {
  if (!existing) { return null; }
  if (existing.text === null) { return null; }
  if (existing.text === text) { return null; }
  return {
    line: lineNum,
    presumedText: existing.text,
    presumedEvidence: existing.evidence,
    observedText: text,
    observedRef: ref
  };
}

// Apply one observed line. Equal to belief -> corroboration (upgrade to
// observed, refresh confirmedAtMs, re-anchor numbering). Different -> the
// observation wins; conflict info {line, presumedText, presumedEvidence,
// observedText, observedRef} comes back for the tracker. Unknown/new -> just
// observed, no conflict (nothing was displaced).
function applyOverlayLine(belief, lineNum, text, ref, unixMs) {
  var conflictInfo = conflictAgainstExisting(belief.entries[lineNum], lineNum, text, ref);
  belief.entries[lineNum] = makeClaimEntry('observed', unixMs, ref, text);
  if (lineNum > belief.lastLine) { belief.lastLine = lineNum; }
  return conflictInfo;
}

// Overlay a byLine array ([{lineNum, text, ref}]); implied lines before the
// span get unknown entries; conflicts are collected and returned.
function applyOverlayLines(belief, byLine, unixMs) {
  var conflicts = [];
  var maxLine = 0;
  for (var i = 0; i < byLine.length; i++) {
    if (byLine[i].lineNum > maxLine) { maxLine = byLine[i].lineNum; }
  }
  ensureImpliedLines(belief, maxLine);
  for (var b = 0; b < byLine.length; b++) {
    var conflict = applyOverlayLine(belief, byLine[b].lineNum, byLine[b].text, byLine[b].ref, unixMs);
    if (conflict) { conflicts.push(conflict); }
  }
  return conflicts;
}

// Drop every entry beyond lastLine (a proved extent shrinks belief).
function dropEntriesBeyond(belief, lastLine) {
  var lineNums = Object.keys(belief.entries).map(Number);
  for (var i = 0; i < lineNums.length; i++) {
    if (lineNums[i] > lastLine) { delete belief.entries[lineNums[i]]; }
  }
}

// A chunk that hit EOF proves where the file ENDS.
function finalizeChunk(belief, hitEof, lastCoveredLine) {
  if (!hitEof) { return; }
  dropEntriesBeyond(belief, lastCoveredLine);
  belief.lastLine = lastCoveredLine;
  belief.eofConfirmed = true;
}

// A whole-file overlay (readFull/cat) witnessed the entire extent.
function finishWholeOverlay(belief, lineCount) {
  dropEntriesBeyond(belief, lineCount);
  belief.lastLine = lineCount;
  belief.eofConfirmed = true;
}

// Conservative drift after a flagged out-of-band change (item 18, userModified):
// un-prove EOF so the verdict stops asserting the (possibly shifted) trailing
// extent. Belief content is left intact — only the EOF claim is withdrawn.
function clearEofConfirmation(belief) {
  belief.eofConfirmed = false;
}

// Tier-1 Write beacon: replaces ALL belief — the file IS this content.
function applyWrite(belief, lines, unixMs) {
  belief.entries = {};
  for (var i = 0; i < lines.length; i++) {
    belief.entries[i + 1] = makeClaimEntry('authored', unixMs, lines[i].ref, lines[i].text);
  }
  belief.lastLine = lines.length;
  belief.eofConfirmed = true;
}

// Tier-1 snapshot beacon: VERIFY accumulated belief against the blob (each
// disagreeing line is conflict info), then anchor as full observed truth.
// Believed lines beyond the blob's extent are dropped by the collapse —
// the beacon is the whole truth, including the file's length.
function applySnapshotVerify(belief, lines, unixMs) {
  var conflicts = [];
  for (var i = 0; i < lines.length; i++) {
    var conflict = conflictAgainstExisting(belief.entries[i + 1], i + 1, lines[i].text, lines[i].ref);
    if (conflict) { conflicts.push(conflict); }
  }
  belief.entries = {};
  for (var n = 0; n < lines.length; n++) {
    belief.entries[n + 1] = makeClaimEntry('observed', unixMs, lines[n].ref, lines[n].text);
  }
  belief.lastLine = lines.length;
  belief.eofConfirmed = true;
  return conflicts;
}

// Tier-1 absence beacon: the file did NOT exist — no lines, extent known.
function applyFileAbsent(belief, unixMs) {
  belief.entries = {};
  belief.lastLine = 0;
  belief.eofConfirmed = true;
}

// Tier-2 absence OBSERVATION (a Bash `rm`): each KNOWN line is contradicted —
// one conflict info carrying the displaced text + the rm ref (observedText
// null) — then belief clears to "no lines exist", EOF known. Unlike the Tier-1
// fileAbsent beacon, this RETURNS the conflicts (rm is inferred: it can fail or
// be followed by a recreate, so it must stay windowed, not anchor as truth).
function applyAbsenceObservation(belief, unixMs, ref) {
  var conflicts = [];
  var lineNums = Object.keys(belief.entries).map(Number);
  for (var i = 0; i < lineNums.length; i++) {
    var entry = belief.entries[lineNums[i]];
    if (entry.text === null) { continue; }
    conflicts.push({ line: lineNums[i], presumedText: entry.text, presumedEvidence: entry.evidence, observedText: null, observedRef: ref });
  }
  belief.entries = {};
  belief.lastLine = 0;
  belief.eofConfirmed = true;
  return conflicts;
}

// After an instant's events: claims not re-established at this instant are
// carried forward — believed, not proven — so they degrade to presumed
// (confirmedAtMs untouched: its distance from now IS the staleness).
function degradeUntouchedToPresumed(belief, touchedLineNums) {
  var lineNums = Object.keys(belief.entries).map(Number);
  for (var i = 0; i < lineNums.length; i++) {
    if (touchedLineNums.has(lineNums[i])) { continue; }
    var entry = belief.entries[lineNums[i]];
    if (entry.state === 'authored') { entry.state = 'presumed'; continue; }
    if (entry.state === 'observed') { entry.state = 'presumed'; }
  }
}

// Roll-up so a timeline can be scanned without opening per-line maps.
function summarizeBelief(belief) {
  var knownLines = 0;
  var unknownLines = 0;
  var lineNums = Object.keys(belief.entries).map(Number);
  for (var i = 0; i < lineNums.length; i++) {
    if (belief.entries[lineNums[i]].state === 'unknown') { unknownLines++; }
    else { knownLines++; }
  }
  var total = knownLines + unknownLines;
  return {
    knownLines: knownLines,
    unknownLines: unknownLines,
    lastLine: belief.lastLine,
    eofConfirmed: belief.eofConfirmed,
    coveragePct: total === 0 ? 1 : knownLines / total
  };
}

// The per-line map a non-beacon timeline entry persists: evidence
// references only — never the in-memory text.
function cloneEntriesForTimeline(belief) {
  var clone = {};
  var lineNums = Object.keys(belief.entries);
  for (var i = 0; i < lineNums.length; i++) {
    var entry = belief.entries[lineNums[i]];
    clone[lineNums[i]] = {
      state: entry.state,
      confirmedAtMs: entry.confirmedAtMs,
      numberingCertain: entry.numberingCertain,
      evidence: entry.evidence
    };
  }
  return clone;
}

module.exports = {
  createBelief: createBelief,
  makeUnknownEntry: makeUnknownEntry,
  makeClaimEntry: makeClaimEntry,
  ensureImpliedLines: ensureImpliedLines,
  extractKnownRuns: extractKnownRuns,
  applyOverlayLine: applyOverlayLine,
  applyOverlayLines: applyOverlayLines,
  finalizeChunk: finalizeChunk,
  finishWholeOverlay: finishWholeOverlay,
  clearEofConfirmation: clearEofConfirmation,
  applyWrite: applyWrite,
  applySnapshotVerify: applySnapshotVerify,
  applyFileAbsent: applyFileAbsent,
  applyAbsenceObservation: applyAbsenceObservation,
  degradeUntouchedToPresumed: degradeUntouchedToPresumed,
  summarizeBelief: summarizeBelief,
  cloneEntriesForTimeline: cloneEntriesForTimeline
};
