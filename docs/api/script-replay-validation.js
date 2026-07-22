// script-replay-validation: build the "expected post-script state" for the forward
// test. The target is the state the instant the script finished at T. The nearest
// captured truth is the first content-establishing BEACON after T (write / snapshot /
// readFull / cat); the observed Edits in (T, beacon] sit between the script and that
// beacon, so we rewind them newest-first onto the beacon to isolate the script's
// effect. Edit records carry before+after, so they invert cleanly — unlike the script
// transform itself, which is why validation runs forward(pre) and never inverts it.
// A window edit whose newString is absent from the beacon is non-invertible: flag,
// never fabricate.

var evidence = require('./line-state-evidence');
var editReplay = require('./edit-replay');
var kinds = require('./file-event-kinds');

// Content-establishing whole-file beacons. readChunk is partial (not a full anchor).
var FULL_BEACON_KINDS = ['write', 'snapshot', 'readFull', 'cat'];

// Invert one forward edit (old->new) on content: replace new with old. ok=false when
// newString is absent — the window can't be rewound through this edit.
function invertEdit(content, edit) {
    if (content.indexOf(edit.newString) < 0) { return { content: content, ok: false }; }
    var inverse = { type: 'edit', oldString: edit.newString, newString: edit.oldString, replaceAll: edit.replaceAll };
    return { content: editReplay.applySingleEdit(inverse, content), ok: true };
}

// Rewind window edits onto the beacon content, newest-first. Returns
// { content, flagged, reason }: a non-invertible edit flags the file (content null).
function rewindEditsNewestFirst(content, edits) {
    for (var i = edits.length - 1; i >= 0; i--) {
        var r = invertEdit(content, edits[i]);
        if (!r.ok) { return { content: null, flagged: true, reason: 'non-invertible window edit: newString absent from beacon' }; }
        content = r.content;
    }
    return { content: content, flagged: false, reason: null };
}

// The earliest full-content beacon strictly after tMs, or null.
function selectBeacon(events, tMs) {
    var best = null;
    for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.unixMs <= tMs) { continue; }
        if (!kinds.doesEventHaveAnyKind(e, FULL_BEACON_KINDS)) { continue; }
        if (best === null || e.unixMs < best.unixMs) { best = e; }
    }
    return best;
}

// Observed edit events in (tMs, beaconMs], ascending by time.
function editsInWindow(events, tMs, beaconMs) {
    var out = [];
    for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.edit && e.unixMs > tMs && e.unixMs <= beaconMs) { out.push(e); }
    }
    out.sort(function (a, b) { return a.unixMs - b.unixMs; });
    return out;
}

// Full text from a content-establishing beacon event, or null.
function beaconContent(event) {
    var m = evidence.materializeEventEvidence(event);
    if (m.lines) { return m.lines.join('\n'); }
    if (m.byLine) { return m.byLine.map(function (e) { return e.text; }).join('\n'); }
    return null;
}

// The materialized {oldString, newString, replaceAll} of each window edit, in order.
function windowEditMaterializations(events, tMs, beaconMs) {
    return editsInWindow(events, tMs, beaconMs).map(function (e) {
        var m = evidence.materializeEventEvidence(e);
        return { oldString: m.oldString, newString: m.newString, replaceAll: m.replaceAll };
    });
}

// The expected post-script state at tMs from the event timeline:
// { via, content, flagged, reason, beaconMs }. via 'none' when no post-T beacon
// exists (a NO-BEACON file — forward-validation cannot run, by design).
function buildExpectedPostScriptState(events, tMs) {
    var beacon = selectBeacon(events, tMs);
    if (!beacon) { return { via: 'none', content: null, flagged: false, reason: 'no post-T beacon' }; }
    var content = beaconContent(beacon);
    if (content === null) { return { via: 'none', content: null, flagged: true, reason: 'beacon content unavailable' }; }
    var rewound = rewindEditsNewestFirst(content, windowEditMaterializations(events, tMs, beacon.unixMs));
    return { via: 'beacon-rewind', content: rewound.content, flagged: rewound.flagged, reason: rewound.reason, beaconMs: beacon.unixMs };
}

// The forward test verdict: does forward(pre) match the expected post-script state?
// { validated, flagged, reason }. A 'none' anchor or a flagged (non-invertible) window
// is NOT a validation — it is reported, never silently treated as a pass.
function compareForward(forwardContent, expected) {
    if (expected.via === 'none') { return { validated: false, flagged: false, reason: 'no post-T beacon to validate against' }; }
    if (expected.flagged) { return { validated: false, flagged: true, reason: expected.reason }; }
    if (forwardContent === expected.content) { return { validated: true, flagged: false, reason: null }; }
    return { validated: false, flagged: false, reason: 'forward(pre) != expected post-script state' };
}

module.exports = {
    rewindEditsNewestFirst: rewindEditsNewestFirst,
    selectBeacon: selectBeacon,
    editsInWindow: editsInWindow,
    beaconContent: beaconContent,
    buildExpectedPostScriptState: buildExpectedPostScriptState,
    compareForward: compareForward
};
