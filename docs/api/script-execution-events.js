// script-execution-events: turn a recorded script RUN into scriptExecution TRANSFORM
// events — one per in-scope alias path — carrying the file-scoped transform applied at
// replay. Detection (pure) lives in script-run-detection; this module adds recovery +
// derivation (recover the CSV as of T_exec, derive the whole-token rename subs) and
// emission. The full transform is recovered+derived ONCE per run (memoized) then scoped
// per alias via subsForFile, since apply-script-execution applies the event's subs to
// every known line.

var transforms = require('./script-transforms');
var recovery = require('./script-recovery');
var detection = require('./script-run-detection');
var createKindEvent = require('./file-event-kinds').createKindEvent;

// Memo so detect+recover+derive runs ONCE per run, not per (transcript × file): the
// recovered CSV (as of T_exec) yields one full transform reused across every file.
var transformCache = {};
function runKey(run) { return run.cwd + ' ' + run.scriptPath + ' ' + run.tExecIso; }

// The FULL transform spec for a run ({ type, subs } over the whole CSV), or null when
// its data input can't be recovered. Memoized by run identity.
function fullTransformForRun(run, jsonlText) {
    var key = runKey(run);
    if (Object.prototype.hasOwnProperty.call(transformCache, key)) { return transformCache[key]; }
    var recovered = recovery.recoverScriptAndInput({
        cwd: run.cwd, scriptPath: run.scriptPath, scriptType: run.type,
        jsonlText: jsonlText, asOfMs: Date.parse(run.tExecIso)
    });
    var spec = recovered.dataInput.content
        ? transforms.deriveTransform(run.type, { csv: recovered.dataInput.content }) : null;
    transformCache[key] = spec;
    return spec;
}

// One scriptExecution event for a (run, aliasPath) pair. The kind sub-object IS the
// transform spec apply-script-execution consumes ({ type, subs } scoped to this file via
// subsForFile) plus detection provenance. A null spec (data input not recoverable)
// yields empty subs — a no-op transform, never a fabrication.
function buildScriptEvent(jsonlPath, run, aliasPath, spec) {
    var subs = spec ? transforms.subsForFile(spec.subs, detection.repoRelOf(aliasPath, run.cwd)) : [];
    var event = createKindEvent(jsonlPath, run.jsonlLine, run.tExecIso, 'scriptExecution', {
        type: spec ? spec.type : 'wholeTokenRename',
        subs: subs,
        scriptType: run.type,
        scriptPath: run.scriptPath,
        cwd: run.cwd
    });
    event.aliasPath = aliasPath;
    return event;
}

// One event per in-scope alias path for one run. The full transform is recovered +
// derived ONCE per run (memoized), then scoped per alias.
function eventsForRun(jsonlPath, jsonlText, run, aliases) {
    var spec = fullTransformForRun(run, jsonlText);
    var events = [];
    for (var a = 0; a < aliases.length; a++) {
        if (!detection.isUnderRepoRoot(aliases[a], run.cwd)) { continue; }
        events.push(buildScriptEvent(jsonlPath, run, aliases[a], spec));
    }
    return events;
}

// Emit scriptExecution events for every detected run × in-scope alias. jsonlText feeds
// script recovery (the recreate-from-JSONL fallback when the data input is off-disk).
function extractScriptExecutionEvents(jsonlPath, jsonlText, parsed, aliasSet) {
    var runs = detection.detectScriptRuns(parsed);
    var aliases = Array.from(aliasSet);
    var events = [];
    for (var i = 0; i < runs.length; i++) {
        Array.prototype.push.apply(events, eventsForRun(jsonlPath, jsonlText, runs[i], aliases));
    }
    return events;
}

module.exports = {
    detectScriptInvocation: detection.detectScriptInvocation,
    detectScriptRuns: detection.detectScriptRuns,
    extractScriptExecutionEvents: extractScriptExecutionEvents
};
