// reconstruction-coverage: the batch-report core (Phases 4-7). Builds the
// jot-scoped file universe, classifies one engine result PASS/FAIL/INDETERMINATE
// against the locked bar, diagnoses where a non-PASS file broke and what data is
// missing, and emits the exact single-file command to re-trace one file. Pure of
// I/O except buildFileUniverse (git tree + on-disk existence checks).

var fs = require('fs');
var path = require('path');
var gitTreeFiles = require('./git-tree-files');
var gitState = require('./git-file-state');
var reconstructFile = require('./reconstruct-file');

// ─── Phase 4: file universe ──────────────────────────────────────────────────

// The set of repo-relative paths touched in the corpus UNDER the real repo root
// (full-path containment, no root inference). Paths outside the repo are dropped;
// computeRepoRelativePath returns null for those.
function collectJsonlRepoRelativePaths(cache, repoRoot) {
    var touchedPaths = reconstructFile.collectDistinctTouchedPaths(cache);
    var relSet = {};
    for (var i = 0; i < touchedPaths.length; i++) {
        var rel = gitState.computeRepoRelativePath(touchedPaths[i], repoRoot);
        if (rel === null) { continue; }
        relSet[rel] = true;
    }
    return relSet;
}

// The deduped jot file universe keyed by repo-relative path: the union of files
// in git@sha and JSONL touches UNDER the real repo root, each flagged inGitAtSha
// / inJsonl / onDisk.
function buildFileUniverse(repoRoot, sha, cache) {
    var gitFiles = gitTreeFiles.listFilesAtCommit(repoRoot, sha);
    var gitSet = {};
    for (var g = 0; g < gitFiles.length; g++) { gitSet[gitFiles[g]] = true; }
    var jsonlSet = collectJsonlRepoRelativePaths(cache, repoRoot);
    var allKeys = {};
    var key;
    for (key in gitSet) { allKeys[key] = true; }
    for (key in jsonlSet) { allKeys[key] = true; }
    var universe = [];
    var keys = Object.keys(allKeys);
    for (var i = 0; i < keys.length; i++) {
        var relPath = keys[i];
        var absPath = path.join(repoRoot, relPath);
        var onDisk = fs.existsSync(absPath);
        // A directory is not a reconstructable file; skip it (avoids EISDIR later).
        if (onDisk) {
            if (fs.statSync(absPath).isDirectory()) { continue; }
        }
        universe.push({
            path: relPath,
            inGitAtSha: gitSet[relPath] === true,
            inJsonl: jsonlSet[relPath] === true,
            onDisk: onDisk
        });
    }
    return universe;
}

// ─── Phase 5: verdict classification ─────────────────────────────────────────

// Flatten an engine finalVerdict into the {comparedVia, mismatched, neverObserved,
// matchedObserved, matchedPresumed, tailUncertain} summary classifyVerdict reads.
function summarizeVerdict(finalVerdict) {
    return {
        comparedVia: finalVerdict.comparedVia,
        matchedObserved: finalVerdict.perLineStats.matchedObserved,
        matchedPresumed: finalVerdict.perLineStats.matchedPresumed,
        mismatched: finalVerdict.perLineStats.mismatched,
        neverObserved: finalVerdict.perLineStats.neverObserved,
        tailUncertain: finalVerdict.tailUncertain
    };
}

// Map a verdict summary to PASS | FAIL | INDETERMINATE per the locked bar.
// No on-disk ground truth -> can't verify -> INDETERMINATE (takes precedence).
// Then any mismatch, any never-observed line, or an unproven EOF is FAIL. A
// full match (including correct-but-presumed lines) is PASS.
function classifyVerdict(verdict) {
    if (verdict.comparedVia !== 'on-disk') { return 'INDETERMINATE'; }
    if (verdict.mismatched > 0) { return 'FAIL'; }
    if (verdict.neverObserved > 0) { return 'FAIL'; }
    if (verdict.tailUncertain) { return 'FAIL'; }
    return 'PASS';
}

// ─── Phase 6: failure diagnosis ──────────────────────────────────────────────

// The first conflict that carries a kind (a real displacement), skipping the
// collapsed-cascade summary records; null when there is none.
function findFirstKindConflict(conflicts) {
    for (var i = 0; i < conflicts.length; i++) {
        if (conflicts[i].kind === 'collapsedCascade') { continue; }
        return conflicts[i];
    }
    return null;
}

// The missing-data hypothesis: the most specific failure mode the engine exposes,
// chosen by single-condition guards evaluated in priority order.
function buildMissingDataHypothesis(finalVerdict, firstConflict, seedClobbered) {
    if (finalVerdict.tailUncertain) {
        return 'no Read/Write/snapshot ever proved EOF — a full-file capture is missing.';
    }
    if (firstConflict) {
        if (firstConflict.kind === 'floatingOverKnownRegion') {
            return "an Edit's old_string didn't match the known belief — an intermediate Read/snapshot between edits is missing (line " + firstConflict.line + ', ~' + firstConflict.timestampOfContradictingRecord + ').';
        }
        if (firstConflict.kind === 'userModified') {
            return 'file was edited outside Claude — not recoverable from this JSONL corpus.';
        }
    }
    if (finalVerdict.perLineStats.neverObserved > 0) {
        return finalVerdict.perLineStats.neverObserved + ' line(s) in ground truth were never touched by any event and are not in the seed — pre-history content missing (consider an earlier seed commit).';
    }
    if (seedClobbered) {
        return 'a post-seed Write/snapshot wiped the git seed (Phase-1 limitation) — the seed did not contribute; a durable seed is needed.';
    }
    return 'reconstruction incomplete — see counters and conflicts for the specific gap.';
}

// For a non-PASS file, where it broke and what data is missing. Reads the engine
// result (finalVerdict + conflicts) plus the precomputed seedClobbered /
// contributingPaths that reconstructFileWithSeed attached.
function diagnoseFailure(result) {
    var finalVerdict = result.finalVerdict;
    var firstConflict = findFirstKindConflict(result.conflicts);
    var firstMismatchLine = null;
    if (finalVerdict.mismatchedLines.length > 0) { firstMismatchLine = finalVerdict.mismatchedLines[0].line; }
    var conflictTimestamp = null;
    var conflictWindow = null;
    if (firstConflict) {
        conflictTimestamp = firstConflict.timestampOfContradictingRecord;
        conflictWindow = firstConflict.window;
    }
    var seedClobbered = result.seedClobbered === true;
    return {
        firstMismatchLine: firstMismatchLine,
        conflictTimestamp: conflictTimestamp,
        conflictWindow: conflictWindow,
        presumedCount: finalVerdict.perLineStats.matchedPresumed,
        comparedVia: finalVerdict.comparedVia,
        tailUncertain: finalVerdict.tailUncertain,
        seedClobbered: seedClobbered,
        contributingPaths: result.contributingPaths ? result.contributingPaths : [],
        missingData: buildMissingDataHypothesis(finalVerdict, firstConflict, seedClobbered)
    };
}

// ─── Phase 7: rerun command ──────────────────────────────────────────────────

// The exact single-file CLI invocation that reproduces one file's row, so a deep
// dive can re-run it and trace the gap. The refactored CLI fans out across jot
// roots itself, so this one command reproduces the row.
function buildRerunCommand(canonicalPath, sha, projectsDir) {
    var basename = path.basename(canonicalPath);
    return "node tools/track-line-states.js --path '" + canonicalPath + "' --seed-commit " + sha +
        " --projects-dir '" + projectsDir + "' --out /tmp/recon-" + basename + '.json';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildFileUniverse: buildFileUniverse,
        summarizeVerdict: summarizeVerdict,
        classifyVerdict: classifyVerdict,
        diagnoseFailure: diagnoseFailure,
        buildRerunCommand: buildRerunCommand
    };
}
