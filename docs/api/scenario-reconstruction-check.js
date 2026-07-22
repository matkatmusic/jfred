// Scenario reconstruction verification helpers: load scenario subfolders,
// classify expected file states, run both engines, and report results.

var fs = require('fs');
var path = require('path');
var unified = require('./unified-reconstruct');
var transcriptParsers = require('./transcript-parsers');
var lineage = require('./file-historical-lineage');
var engines = require('./scenario-reconstruction-engines');

// Scaffolding files that are NOT ground-truth scenario output.
var SCAFFOLDING_DENYLIST = {
    'jsonl_path.txt': true, 'ready': true, 'done': true,
    '.DS_Store': true, 'settings.json': true, 'hooks.json': true,
    'block-compound.sh': true, 'conftest.py': true
};

function isScaffoldingFile(filename) {
    if (SCAFFOLDING_DENYLIST[filename]) { return true; }
    if (filename.endsWith('.jsonl')) { return true; }
    if (filename.indexOf('-run-') >= 0 && filename.endsWith('.txt')) { return true; }
    return false;
}

// ─── Loader helpers ─────────────────────────────────────────────────────────

function getScenarioSubfolderPaths(executedDir) {
    var entries = fs.readdirSync(executedDir).sort();
    var dirs = [];
    for (var i = 0; i < entries.length; i++) {
        var full = path.join(executedDir, entries[i]);
        if (fs.statSync(full).isDirectory()) { dirs.push(full); }
    }
    return dirs;
}

function findScenarioJsonlPath(subfolderPath) {
    var entries = fs.readdirSync(subfolderPath);
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].endsWith('.jsonl')) {
            return path.join(subfolderPath, entries[i]);
        }
    }
    return null;
}

function collectTopLevelGroundTruthFiles(subfolderPath) {
    var results = [];
    var entries = fs.readdirSync(subfolderPath);
    for (var i = 0; i < entries.length; i++) {
        if (isScaffoldingFile(entries[i])) { continue; }
        var full = path.join(subfolderPath, entries[i]);
        if (!fs.statSync(full).isFile()) { continue; }
        results.push({ relPath: entries[i], content: fs.readFileSync(full, 'utf8') });
    }
    return results;
}

function collectTestsSubdirGroundTruthFiles(subfolderPath) {
    var testsDir = path.join(subfolderPath, 'tests');
    if (!fs.existsSync(testsDir)) { return []; }
    if (!fs.statSync(testsDir).isDirectory()) { return []; }
    var results = [];
    var entries = fs.readdirSync(testsDir);
    for (var i = 0; i < entries.length; i++) {
        if (isScaffoldingFile(entries[i])) { continue; }
        var full = path.join(testsDir, entries[i]);
        if (!fs.statSync(full).isFile()) { continue; }
        results.push({ relPath: 'tests/' + entries[i], content: fs.readFileSync(full, 'utf8') });
    }
    return results;
}

function collectPresentGroundTruthFiles(subfolderPath) {
    var top = collectTopLevelGroundTruthFiles(subfolderPath);
    var nested = collectTestsSubdirGroundTruthFiles(subfolderPath);
    return top.concat(nested);
}

// ─── Lineage / removed paths ────────────────────────────────────────────────

function getRemovedOrMovedAwayPaths(localJsonlPath) {
    var text = fs.readFileSync(localJsonlPath, 'utf8');
    var collected = lineage.collectTouches(text);
    var ops = collected.ops;
    var priorPaths = [];
    for (var i = 0; i < ops.length; i++) {
        if (ops[i].type === 'mv' || ops[i].type === 'git-mv') {
            priorPaths.push(ops[i].src);
        }
        if (ops[i].type === 'rm') {
            priorPaths.push(ops[i].src || ops[i].path);
        }
    }
    return priorPaths;
}

// ─── Classification + resolution ────────────────────────────────────────────

function classifyExpectedState(basename, presentRelPaths) {
    for (var i = 0; i < presentRelPaths.length; i++) {
        var name = path.basename(presentRelPaths[i]);
        if (name === basename) { return 'present'; }
    }
    return 'absent';
}

function resolveAbsoluteTargetPath(jsonlText, relPath) {
    var meta = transcriptParsers.extractSessionMetadata(jsonlText);
    return path.join(meta.cwd, relPath);
}

// ─── Engine A (unified-reconstruct) adapter ─────────────────────────────────

function reconstructWithUnifiedEngine(jsonlText, jsonlPath, absoluteTargetPath) {
    var jsonlTexts = [{ text: jsonlText, path: jsonlPath }];
    return unified.reconstructFromJSONLTexts(jsonlTexts, absoluteTargetPath);
}

function checkUnifiedEngineResult(engineContent, expectedState, expectedContent) {
    if (expectedState === 'present') {
        var matches = engineContent === expectedContent;
        return { pass: matches, detail: matches ? 'content matches' : 'content mismatch' };
    }
    var isEmpty = engineContent === '';
    return { pass: isEmpty, detail: isEmpty ? 'absent confirmed' : 'absent expected but content produced' };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function buildPerFileRecord(stem, relPath, expectedState, unifiedResult, sidecarResult) {
    return {
        stem: stem,
        relPath: relPath,
        expectedState: expectedState,
        unifiedPass: unifiedResult.pass,
        sidecarPass: sidecarResult.pass,
        agree: unifiedResult.pass === sidecarResult.pass
    };
}

function formatReportLine(record) {
    var uTag = record.unifiedPass ? 'PASS' : 'FAIL';
    var sTag = record.sidecarPass ? 'PASS' : 'FAIL';
    var aTag = record.agree ? 'AGREE' : 'DISAGREE';
    return record.stem + '/' + record.relPath +
        '  unified=' + uTag + '  sidecar=' + sTag + '  ' + aTag;
}

function formatReport(records) {
    var lines = ['=== SCENARIO RECONSTRUCTION VERIFICATION ===', ''];
    for (var i = 0; i < records.length; i++) {
        lines.push(formatReportLine(records[i]));
    }
    var disagrees = records.filter(function (r) { return !r.agree; });
    if (disagrees.length > 0) {
        lines.push('');
        lines.push('--- DISAGREEMENTS ---');
        for (var d = 0; d < disagrees.length; d++) {
            lines.push('  ' + formatReportLine(disagrees[d]));
        }
    }
    lines.push('');
    var passCount = records.filter(function (r) { return r.agree; }).length;
    lines.push('Total: ' + records.length + '  Agree: ' + passCount +
        '  Disagree: ' + disagrees.length);
    return lines.join('\n');
}

function countUnexpectedFailures(records) {
    var count = 0;
    for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.expectedState === 'absent' && !r.unifiedPass && r.sidecarPass) {
            continue;
        }
        if (!r.unifiedPass) { count++; continue; }
        if (!r.sidecarPass) { count++; }
    }
    return count;
}

module.exports = {
    getScenarioSubfolderPaths: getScenarioSubfolderPaths,
    findScenarioJsonlPath: findScenarioJsonlPath,
    collectPresentGroundTruthFiles: collectPresentGroundTruthFiles,
    getRemovedOrMovedAwayPaths: getRemovedOrMovedAwayPaths,
    classifyExpectedState: classifyExpectedState,
    resolveAbsoluteTargetPath: resolveAbsoluteTargetPath,
    reconstructWithUnifiedEngine: reconstructWithUnifiedEngine,
    checkUnifiedEngineResult: checkUnifiedEngineResult,
    resolveAliasPathsForTarget: engines.resolveAliasPathsForTarget,
    reconstructWithSidecarEngine: engines.reconstructWithSidecarEngine,
    checkSidecarEngineResult: engines.checkSidecarEngineResult,
    checkSidecarAbsence: engines.checkSidecarAbsence,
    buildPerFileRecord: buildPerFileRecord,
    formatReport: formatReport,
    countUnexpectedFailures: countUnexpectedFailures
};
