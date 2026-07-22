// Engine B (sidecar) adapter for scenario reconstruction verification.
// Mirrors the tools/track-line-states.js driver pattern but reads from
// a self-contained scenario subfolder instead of ~/.claude/projects.

var transcriptDiscovery = require('./transcript-discovery');
var lineage = require('./file-historical-lineage');
var aliasWindowsModule = require('./alias-windows');
var fileEventsExtractors = require('./file-events-extractors');
var trackLineStatesApi = require('./track-line-states');
var promotePerLine = require('./promote-per-line-status');

// ─── Alias resolution ───────────────────────────────────────────────────────

function resolveAliasPathsForTarget(absoluteTargetPath, subfolderPath) {
    var cache = transcriptDiscovery.loadAllJsonlFilesInProjectsFolder(subfolderPath);
    var allOps = lineage.gatherAllOps(cache);
    var windows = aliasWindowsModule.resolveAliasWindows([absoluteTargetPath], allOps);
    return { aliasPaths: Array.from(windows.keys()), windows: windows };
}

// ─── Engine B reconstruction ────────────────────────────────────────────────

function reconstructWithSidecarEngine(localJsonlPath, absoluteTargetPath, subfolderPath, referenceContent, snapshotsDir) {
    var aliasInfo = resolveAliasPathsForTarget(absoluteTargetPath, subfolderPath);
    var aliasPaths = aliasInfo.aliasPaths;
    var events = fileEventsExtractors.extractFileEvents(
        localJsonlPath, aliasPaths, snapshotsDir || null
    );
    events = aliasWindowsModule.filterEventsByAliasWindows(events, aliasInfo.windows);
    var reference = { via: 'groundtruth', content: referenceContent };
    var result = trackLineStatesApi.trackLineStates(events, {
        filePath: absoluteTargetPath,
        aliasPaths: aliasPaths,
        jsonlsScanned: [localJsonlPath],
        reference: reference
    });
    return result;
}

// ─── Engine B verdict checking ──────────────────────────────────────────────

function checkSidecarAbsence(result) {
    if (!result) { return false; }
    var timeline = result.timeline;
    if (!timeline) { return false; }
    var keys = Object.keys(timeline).map(Number).sort(function (a, b) { return a - b; });
    if (keys.length === 0) { return false; }
    var lastEntry = timeline[String(keys[keys.length - 1])];
    if (!lastEntry) { return false; }
    if (!lastEntry.events) { return false; }
    for (var i = 0; i < lastEntry.events.length; i++) {
        if (lastEntry.events[i].fileAbsent) { return true; }
    }
    return false;
}

function checkSidecarEngineResult(result, expectedState) {
    if (expectedState === 'present') {
        var perfect = promotePerLine.checkVerdictPerLinePerfect(result.finalVerdict);
        return { pass: perfect, detail: perfect ? 'per-line perfect' : 'per-line mismatch' };
    }
    var absent = checkSidecarAbsence(result);
    return { pass: absent, detail: absent ? 'absent confirmed' : 'absent not concluded' };
}

module.exports = {
    resolveAliasPathsForTarget: resolveAliasPathsForTarget,
    reconstructWithSidecarEngine: reconstructWithSidecarEngine,
    checkSidecarAbsence: checkSidecarAbsence,
    checkSidecarEngineResult: checkSidecarEngineResult
};
