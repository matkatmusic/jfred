// apply-script-execution: apply a scriptExecution TRANSFORM event to the belief.
// A scriptExecution event carries a transform spec ({ type, subs }) recovered from
// the recorded run of a file-rewriting script. Unlike content events, its effect
// depends on the LIVE belief at replay time, so the transform is applied here.
//
// Whole-token renames are applied SEQUENTIALLY (each sub sees the prior sub's
// output, mirroring the script re-reading the file per row) to every KNOWN line;
// line count is unchanged. A LOCAL sub over a fully-known file whose actual
// whole-token count != expectedCount is SKIPPED and flagged — the faithful mirror
// of rename-functions.py's per-row count-assertion abort (no partial writes), and
// a signal that the reconstructed pre-state diverges from what the script saw.
// GLOBAL subs are not per-file gated (their assertion is the whole-run sum).

var lb = require('./line-belief');
var st = require('./script-transforms');

// A synthetic evidence ref for a line whose content was DERIVED by the script
// transform (no verbatim transcript span holds it). Same ref shape as the rest;
// the verdict compares in-memory text, so this ref is provenance-only.
function buildScriptRef(event, text) {
    return {
        jsonl: event.jsonl,
        jsonlLine: event.jsonlLine,
        textProperty: { property: 'scriptExecution.derivedContent', startIndex: 0, endIndex: text.length },
        structuredPatch: null,
        blobFile: null
    };
}

// Preview one sub over the current known lines WITHOUT mutating: total whole-token
// count + the per-line replacement results. Reads live entry.text so sequential
// subs compound.
function previewSub(belief, sub) {
    var lineNums = Object.keys(belief.entries).map(Number);
    var count = 0;
    var changes = [];
    for (var i = 0; i < lineNums.length; i++) {
        var entry = belief.entries[lineNums[i]];
        if (entry.text === null) { continue; }
        var r = st.applyWholeToken(entry.text, sub.old, sub.new);
        if (r.count > 0) { count += r.count; changes.push({ lineNum: lineNums[i], text: r.content }); }
    }
    return { count: count, changes: changes };
}

// LOCAL sub over a fully-known file must match its expected count or it is skipped
// (the script aborts that row). Partial belief / global subs are not gated here.
function shouldApplySub(belief, sub, count) {
    if (sub.scope === 'local' && belief.eofConfirmed && count !== sub.expectedCount) { return false; }
    return true;
}

function buildCountMismatchFlag(sub, actual) {
    return { kind: 'scriptCountMismatch', old: sub.old, new: sub.new, scope: sub.scope, actual: actual, expected: sub.expectedCount };
}

function applyChanges(belief, changes, event) {
    for (var i = 0; i < changes.length; i++) {
        var ref = buildScriptRef(event, changes[i].text);
        belief.entries[changes[i].lineNum] = lb.makeClaimEntry('authored', event.unixMs, ref, changes[i].text);
    }
}

// Apply the transform; returns flags (skipped count-mismatch subs), no belief
// content is fabricated — every change is a recorded sub applied to a known line.
function applyScriptExecution(belief, event) {
    var spec = event.scriptExecution;
    var flags = [];
    for (var i = 0; i < spec.subs.length; i++) {
        var sub = spec.subs[i];
        var pv = previewSub(belief, sub);
        if (!shouldApplySub(belief, sub, pv.count)) { flags.push(buildCountMismatchFlag(sub, pv.count)); continue; }
        applyChanges(belief, pv.changes, event);
    }
    return flags;
}

module.exports = {
    applyScriptExecution: applyScriptExecution
};
