// final-line-verdict: compare final belief against the best available
// reference — the per-line generalization of PASS/MISMATCH. matchedPresumed
// counting separately from matchedObserved says how much of a "match" rests
// on unverified carry-forward versus actual observation.

var evidence = require('./line-state-evidence');

function createEmptyVerdictCounters() {
  return { matchedObserved: 0, matchedPresumed: 0, mismatched: 0, neverObserved: 0 };
}

// One mismatchedLines record: self-contained (number, last state, OUR
// evidence reference copied in, excerpts of both sides for reading).
function buildMismatchRecord(lineNum, entry, referenceText) {
  return {
    line: lineNum,
    lastState: entry.state,
    evidence: entry.evidence,
    excerpt: {
      reconstructed: evidence.makeExcerpt(entry.text),
      reference: evidence.makeExcerpt(referenceText)
    }
  };
}

// Bucket one line: which stat it increments, and its mismatch record if any.
function compareLineForVerdict(entry, referenceText, lineNum) {
  var hasClaim = entry ? entry.text !== null : false;
  if (!hasClaim) {
    if (referenceText === undefined) { return { stat: null, mismatch: null }; }
    return { stat: 'neverObserved', mismatch: null };
  }
  if (referenceText === undefined) {
    return { stat: 'mismatched', mismatch: buildMismatchRecord(lineNum, entry, null) };
  }
  if (entry.text !== referenceText) {
    return { stat: 'mismatched', mismatch: buildMismatchRecord(lineNum, entry, referenceText) };
  }
  if (entry.state === 'presumed') { return { stat: 'matchedPresumed', mismatch: null }; }
  return { stat: 'matchedObserved', mismatch: null };
}

// The end-state comparison. reference is {via, content}: via follows the
// probe's source ladder ('on-disk' | 'snapshot' | 'git' | 'none'); 'none'
// compares nothing and only reports what the timeline believed.
function buildFinalVerdict(belief, reference) {
  var verdict = {
    comparedVia: reference.via,
    perLineStats: createEmptyVerdictCounters(),
    mismatchedLines: [],
    tailUncertain: !belief.eofConfirmed
  };
  if (reference.via === 'none') { return verdict; }
  var referenceLines = evidence.splitContentIntoLineSpans(reference.content);
  var lastLine = Math.max(referenceLines.length, belief.lastLine);
  for (var lineNum = 1; lineNum <= lastLine; lineNum++) {
    var outcome = compareLineForVerdict(belief.entries[lineNum], referenceLines[lineNum - 1], lineNum);
    if (outcome.stat) { verdict.perLineStats[outcome.stat]++; }
    if (outcome.mismatch) { verdict.mismatchedLines.push(outcome.mismatch); }
  }
  return verdict;
}

module.exports = {
  buildFinalVerdict: buildFinalVerdict
};
