// Item 15: a file the probe byte-calls MISMATCH may still be per-line-perfect
// once the sidecar engine's richer belief (items 1-12) is scored against the
// SAME reference. Re-run the engine for one MISMATCH file and, when its
// per-line verdict has zero contradictions AND full reference coverage,
// upgrade the status to PASS_PER_LINE. Reconstruction bytes are never touched.

var extractors = require('./file-events-extractors');
var tracker = require('./track-line-states');

var PASS_PER_LINE = 'PASS_PER_LINE';

// Merge sidecar events across all of a file's transcripts, mirroring the probe
// (full aliasPaths, no alias-window filter -- reference parity with the probe).
function gatherFileEventsAcrossTranscripts(transcriptJsonlPaths, aliasPaths, snapshotsDir) {
    var events = [];
    for (var i = 0; i < transcriptJsonlPaths.length; i++) {
        var produced = extractors.extractFileEvents(transcriptJsonlPaths[i], aliasPaths, snapshotsDir);
        Array.prototype.push.apply(events, produced);
    }
    return events;
}

// Per-line-perfect: no observed line contradicts the reference (mismatched 0)
// AND every reference line is covered (neverObserved 0 -- never claim a line we
// never saw; this also rejects the empty-belief vacuous pass).
function checkVerdictPerLinePerfect(verdict) {
    if (!verdict) { return false; }
    var stats = verdict.perLineStats;
    if (!stats) { return false; }
    if (stats.mismatched !== 0) { return false; }
    if (stats.neverObserved !== 0) { return false; }
    return true;
}

// Re-score ONE byte-MISMATCH file per-line against the reference the probe
// used, then upgrade to PASS_PER_LINE when the verdict is per-line-perfect.
// Only MISMATCH is eligible: PASS / NOT_FOUND / NOT_TESTABLE pass through
// untouched. The guard MUST stay '=== MISMATCH', never '!== PASS' -- NOT_FOUND
// has via 'none', whose verdict early-returns empty and would vacuously pass.
function promotePerLineStatus(decision, aliasPaths, transcriptJsonlPaths, snapshotsDir) {
    if (decision.status !== 'MISMATCH') { return decision; }
    var reference = { via: decision.comparedVia, content: decision.usedSource.content };
    var events = gatherFileEventsAcrossTranscripts(transcriptJsonlPaths, aliasPaths, snapshotsDir);
    var result = tracker.trackLineStates(events, { reference: reference });
    if (!checkVerdictPerLinePerfect(result.finalVerdict)) { return decision; }
    decision.status = PASS_PER_LINE;
    return decision;
}

module.exports = {
    PASS_PER_LINE: PASS_PER_LINE,
    gatherFileEventsAcrossTranscripts: gatherFileEventsAcrossTranscripts,
    checkVerdictPerLinePerfect: checkVerdictPerLinePerfect,
    promotePerLineStatus: promotePerLineStatus
};
