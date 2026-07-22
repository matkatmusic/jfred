// conflict-cascade-collapse (api): collapse per-line conflict CASCADES in the
// tracker's diagnostic `conflicts` array (roadmap item 12). When an untracked
// insertion of K lines shifts every downstream line, a later overlay on the
// pre-insertion numbering disagrees with belief on every line at/below the
// insert — N per-line conflict records for ONE logical event. This replaces each
// such constant-offset SHIFT cascade with one synthetic `collapsedCascade`
// record (span, count, signed offset, raw member lines preserved — no data loss).
//
// Pure and report-only: it reads the conflicts array and returns a NEW array.
// It MUST NOT touch belief or the per-line verdict (finalVerdict.perLineStats),
// which item 15 consumes raw. The shift criterion reuses the LCS engine in
// api/line-diff.js. New file -> 4-space throughout (in-place callers stay 2-space).

var diff = require('./line-diff');

// A single displaced line is not a cascade; a real shift spans >= 2 lines.
var MIN_CASCADE_LENGTH = 2;
// The realigned (shifted) overlap must cover >= half the run for it to count as a
// constant-offset shift: 2 * ctxCount >= run.length.
var MIN_SHIFT_OVERLAP_HALVES = 2;

// The Item-11 skip-guard: only per-line records (numeric line) are groupable.
// Floating records (kind floatingOverKnownRegion, line null) and any future
// non-per-line variant are passed through untouched.
function isPerLineConflict(record) {
    return typeof record.line === 'number';
}

// The identity of the overlay event a per-line conflict came from: one
// applySnapshotVerify / applyOverlayLines / applyAbsenceObservation call pushes
// all its infos at the same timestamp AND the same beacon-bounded window.
function computeMomentKey(record) {
    return record.timestampOfContradictingRecord + '|' + record.window.fromBeaconMs + '|' + record.window.toBeaconMs;
}

// Group per-line conflicts by their originating moment (timestamp + window),
// preserving first-encounter order; each group's members sorted by line ascending.
function groupConflictsByMoment(perLineConflicts) {
    var groupsByKey = {};
    var order = [];
    for (var i = 0; i < perLineConflicts.length; i++) {
        var key = computeMomentKey(perLineConflicts[i]);
        if (!groupsByKey[key]) {
            groupsByKey[key] = { members: [] };
            order.push(key);
        }
        groupsByKey[key].members.push(perLineConflicts[i]);
    }
    var groups = [];
    for (var g = 0; g < order.length; g++) {
        var group = groupsByKey[order[g]];
        group.members.sort(function (a, b) { return a.line - b.line; });
        groups.push(group);
    }
    return groups;
}

// Split a line-sorted member list into maximal runs of consecutive line numbers
// (a gap starts a new run). Mirrors line-belief extractKnownRuns arithmetic.
function splitIntoConsecutiveLineRuns(sortedMembers) {
    var runs = [];
    var current = null;
    for (var i = 0; i < sortedMembers.length; i++) {
        var member = sortedMembers[i];
        var extendsCurrent = current !== null ? member.line === current[current.length - 1].line + 1 : false;
        if (!extendsCurrent) {
            current = [];
            runs.push(current);
        }
        current.push(member);
    }
    return runs;
}

// Tally context (unchanged-line) ops in an LCS alignment.
function countContextOps(ops) {
    var ctxCount = 0;
    for (var i = 0; i < ops.length; i++) {
        if (ops[i].op === 'ctx') { ctxCount++; }
    }
    return ctxCount;
}

// Signed length of the leading non-ctx op block after skipping any leading ctx
// ops: +N for a leading 'add' run (insertion at the run top), -N for a leading
// 'del' run (deletion). 0 if the diff opens with no directional block. A
// directional hint only; the collapse decision is the overlap criterion below.
function computeLeadingShiftOffset(ops) {
    var i = 0;
    while (i < ops.length) {
        if (ops[i].op !== 'ctx') { break; }
        i++;
    }
    if (i >= ops.length) { return 0; }
    var leadOp = ops[i].op;
    var count = 0;
    while (i < ops.length) {
        if (ops[i].op !== leadOp) { break; }
        count++;
        i++;
    }
    if (leadOp === 'add') { return count; }
    return -count;
}

// Decide whether a consecutive-line run is one constant-offset shift cascade. The
// run's presumed (believed) texts vs its observed texts realign under an LCS with
// a large common subsequence and a small unmatched boundary block; when that
// overlap dominates (>= half the run) the disagreement is a shift, not N
// independent edits. Texts here are already excerpts (<= 80 chars), so the test
// is conservative: a false negative leaves the cascade un-collapsed (safe).
function computeShiftOffset(run) {
    var presumedTexts = run.map(function (c) { return c.excerpt.presumedText; });
    var observedTexts = run.map(function (c) { return c.excerpt.observedText; });
    var ops = diff.computeLineDiff(presumedTexts, observedTexts);
    var ctxCount = countContextOps(ops);
    var longEnough = run.length >= MIN_CASCADE_LENGTH;
    var overlapDominates = MIN_SHIFT_OVERLAP_HALVES * ctxCount >= run.length;
    var collapsible = false;
    if (longEnough) {
        if (overlapDominates) { collapsible = true; }
    }
    return { collapsible: collapsible, shiftOffset: computeLeadingShiftOffset(ops) };
}

// One synthetic record standing in for a whole shift cascade. memberLines keeps
// the raw per-line numbers so no diagnostic data is lost; excerpt carries the
// first line's two sides as a sample.
function buildCollapsedConflictRecord(run, shiftOffset) {
    var first = run[0];
    var last = run[run.length - 1];
    return {
        kind: 'collapsedCascade',
        timestampOfContradictingRecord: first.timestampOfContradictingRecord,
        firstLine: first.line,
        lastLine: last.line,
        lineCount: run.length,
        shiftOffset: shiftOffset,
        window: first.window,
        memberLines: run.map(function (c) { return c.line; }),
        excerpt: {
            firstPresumedText: first.excerpt.presumedText,
            firstObservedText: first.excerpt.observedText
        }
    };
}

// Render a signed offset for human output: +K / -K / +0.
function formatSignedOffset(shiftOffset) {
    if (shiftOffset >= 0) { return '+' + shiftOffset; }
    return String(shiftOffset);
}

// Human one-liner for the CLI printer: span, collapsed count, signed shift, window.
function describeCollapsedConflict(record) {
    return 'cascade lines ' + record.firstLine + '-' + record.lastLine +
        ' (' + record.lineCount + ' conflicts, shift ' + formatSignedOffset(record.shiftOffset) +
        ') window [' + record.window.fromBeaconMs + ' .. ' + record.window.toBeaconMs + ']';
}

// Sort key within a timestamp: collapsed records by their first line, per-line
// records by their line, floating (null) records first.
function conflictSortLine(record) {
    if (record.kind === 'collapsedCascade') { return record.firstLine; }
    if (record.line === null) { return -1; }
    return record.line;
}

function compareCollapsedOutput(a, b) {
    if (a.timestampOfContradictingRecord !== b.timestampOfContradictingRecord) {
        return a.timestampOfContradictingRecord - b.timestampOfContradictingRecord;
    }
    return conflictSortLine(a) - conflictSortLine(b);
}

// A collapsible run becomes one synthetic record; otherwise its members pass
// through unchanged (same references — never mutated).
function collapseRun(run, output) {
    var shift = computeShiftOffset(run);
    if (shift.collapsible) {
        output.push(buildCollapsedConflictRecord(run, shift.shiftOffset));
        return;
    }
    for (var i = 0; i < run.length; i++) {
        output.push(run[i]);
    }
}

// Public entry: returns a NEW conflicts array with shift cascades replaced by one
// record each; every other record (un-collapsed per-line + floating) passed
// through unchanged; ordered by (timestamp, firstLine|line). Input never mutated.
function collapseConflictCascades(conflicts) {
    var perLine = [];
    var passThrough = [];
    for (var i = 0; i < conflicts.length; i++) {
        if (isPerLineConflict(conflicts[i])) {
            perLine.push(conflicts[i]);
            continue;
        }
        passThrough.push(conflicts[i]);
    }
    var output = [];
    var groups = groupConflictsByMoment(perLine);
    for (var g = 0; g < groups.length; g++) {
        var runs = splitIntoConsecutiveLineRuns(groups[g].members);
        for (var r = 0; r < runs.length; r++) {
            collapseRun(runs[r], output);
        }
    }
    for (var p = 0; p < passThrough.length; p++) {
        output.push(passThrough[p]);
    }
    output.sort(compareCollapsedOutput);
    return output;
}

module.exports = {
    isPerLineConflict: isPerLineConflict,
    groupConflictsByMoment: groupConflictsByMoment,
    splitIntoConsecutiveLineRuns: splitIntoConsecutiveLineRuns,
    computeShiftOffset: computeShiftOffset,
    buildCollapsedConflictRecord: buildCollapsedConflictRecord,
    describeCollapsedConflict: describeCollapsedConflict,
    collapseConflictCascades: collapseConflictCascades
};
