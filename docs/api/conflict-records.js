// conflict-records: the schema records the per-line tracker emits when an
// observation contradicts belief. Split out of track-line-states.js so the engine
// file stays focused on replay/timeline mechanics. Two record shapes — a per-line
// displacement and a whole-region "floating" diagnostic (item 11 / item 18) — plus
// appendConflictRecords, which routes each applyOneEvent conflict-info to the right
// shape. Pure given line-state-evidence (only makeExcerpt). New file -> 4-space.

var evidence = require('./line-state-evidence');

// Schema conflict record: the observation won the line; this preserves what
// was displaced and where both sides' proof lives, localized to the window
// between the last beacon and this moment of discovery.
function buildConflictRecord(info, unixMs, fromBeaconMs) {
    return {
        timestampOfContradictingRecord: unixMs,
        line: info.line,
        presumed: info.presumedEvidence,
        observed: info.observedRef,
        excerpt: {
            presumedText: evidence.makeExcerpt(info.presumedText),
            observedText: evidence.makeExcerpt(info.observedText)
        },
        window: { fromBeaconMs: fromBeaconMs, toBeaconMs: unixMs }
    };
}

// Schema record for a floating-over-known-region conflict (item 11): an edit whose
// old_string matched no known run while belief was fully known (no gap, EOF proved)
// provably contradicts belief. No single displaced line, so line/presumed are null;
// observed points at the edit's authored proof. Carries the same mandatory fields
// the CLI printer reads (timestamp, excerpt, window) plus a kind discriminator
// (additive; no consumer reads kind today).
function buildFloatingConflictRecord(info, unixMs, fromBeaconMs) {
    var excerpt = {};
    excerpt.presumedText = evidence.makeExcerpt(info.presumedText);
    excerpt.observedText = evidence.makeExcerpt(info.observedText);
    var record = {};
    record.kind = info.kind;
    record.timestampOfContradictingRecord = unixMs;
    record.line = info.line;
    record.presumed = info.presumedEvidence;
    record.observed = info.observedRef;
    record.excerpt = excerpt;
    record.window = { fromBeaconMs: fromBeaconMs, toBeaconMs: unixMs };
    return record;
}

// Wrap each applyOneEvent conflict-info into its schema record. A KINDED info
// (item 11 floatingOverKnownRegion, item 18 userModified) is a whole-region
// diagnostic with no single displaced line; buildFloatingConflictRecord copies its
// kind through. Per-line infos carry no kind -> the per-line record.
function appendConflictRecords(conflicts, infos, unixMs, fromBeaconMs) {
    for (var c = 0; c < infos.length; c++) {
        if (infos[c].kind) {
            conflicts.push(buildFloatingConflictRecord(infos[c], unixMs, fromBeaconMs));
            continue;
        }
        conflicts.push(buildConflictRecord(infos[c], unixMs, fromBeaconMs));
    }
}

module.exports = {
    appendConflictRecords: appendConflictRecords
};
