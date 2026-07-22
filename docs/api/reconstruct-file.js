// reconstruct-file: the reusable single-file reconstruction orchestration.
// One function reproduces the per-file pipeline the track-line-states CLI runs
// (alias-window discovery, cross-root evidence gathering, reference-ladder
// selection, optional git seed, then the engine), but takes a PRELOADED corpus
// cache so a batch can scan the 765 MB corpus once and gather evidence across
// EVERY jot-identity root. The CLI delegates to this so both share one path.

var fs = require('fs');
var path = require('path');
var transcriptDiscovery = require('./transcript-discovery');
var subagentDiscovery = require('./subagent-transcript-discovery');
var lineage = require('./file-historical-lineage');
var aliasWindows = require('./alias-windows');
var efe = require('./file-events-extractors');
var referenceLadder = require('./reference-ladder');
var gitSeed = require('./git-seed');
var gitCommitMatches = require('./git-commit-matches');
var tls = require('./track-line-states');
var scriptDetection = require('./script-run-detection');

// One corpus scan that includes BOTH main and subagent transcripts, so callers
// reuse a single cache. Mirrors findReferencingJsonlsIncludingSubagents' union.
function loadCombinedCache(projectsDir) {
    var mainCache = transcriptDiscovery.loadAllJsonlFilesInProjectsFolder(projectsDir);
    var subagentFiles = subagentDiscovery.enumerateSubagentJsonls(projectsDir);
    var subagentCache = transcriptDiscovery.collectAllJsonls(subagentFiles);
    return mainCache.concat(subagentCache);
}

// Every distinct absolute path touched anywhere in the cache. Feeds jot-root
// detection (which corpus roots overlap the git tracked-file set).
function collectDistinctTouchedPaths(cache) {
    var seen = {};
    var paths = [];
    for (var i = 0; i < cache.length; i++) {
        var touches = cache[i].touches;
        for (var t = 0; t < touches.length; t++) {
            var touchPath = touches[t].path;
            if (seen[touchPath]) { continue; }
            seen[touchPath] = true;
            paths.push(touchPath);
        }
    }
    return paths;
}

// The most recent snapshot blob among the events, or null. (moved from CLI)
function findLatestSnapshotBlob(events) {
    var best = null;
    for (var i = 0; i < events.length; i++) {
        if (!events[i].snapshot) { continue; }
        if (best === null) { best = events[i]; continue; }
        if (events[i].unixMs > best.unixMs) { best = events[i]; }
    }
    return best ? best.snapshot.blob : null;
}

// True only when target exists AND is a regular file (never a directory), so the
// on-disk reference rung never tries to readFileSync a directory (EISDIR).
function isExistingFile(target) {
    if (!fs.existsSync(target)) { return false; }
    return fs.statSync(target).isFile();
}

// The probe's source ladder, first available wins: on-disk, else latest snapshot
// blob, else git, else none. The !== null guard keeps a git-tracked EMPTY file a
// valid reference. Moved verbatim from the CLI so its ordering tests still cover it.
function chooseReference(target, events, aliasPaths, transcriptTexts) {
    if (isExistingFile(target)) { return { via: 'on-disk', content: fs.readFileSync(target, 'utf8') }; }
    var blob = findLatestSnapshotBlob(events);
    if (blob) { return { via: 'snapshot', content: fs.readFileSync(blob, 'utf8') }; }
    var gitContent = referenceLadder.resolveGitReference(target, aliasPaths, transcriptTexts);
    if (gitContent !== null) { return { via: 'git', content: gitContent }; }
    return { via: 'none', content: null };
}

// The seed alias set for a canonical full path: the provenance closure over the
// recorded cp/mv/git-mv lineage graph. A same-name file under another location is
// included ONLY when an op proves it shares bytes with the canonical file — never
// by filename. The canonical path is always first (resolveAliases seeds with it).
function buildSeedAliases(canonicalPath, lineageGraph) {
    return Array.from(lineage.resolveAliases([canonicalPath], lineageGraph));
}

// True when any of a transcript's recorded script runs covers a target alias (its repo
// root is a prefix). A run write leaves no touch, so these transcripts are invisible to
// touch-based discovery — the bridge re-includes them for the files the run rewrote.
function runCoversAnyAlias(runs, aliasPaths) {
    if (!runs) { return false; }
    return runs.some(function (run) {
        return aliasPaths.some(function (a) { return scriptDetection.isUnderRepoRoot(a, run.cwd); });
    });
}

// Transcripts whose recorded script runs cover any target alias (the discovery bridge).
function jsonlsWithCoveringRuns(cache, aliasPaths) {
    if (!cache) { return []; }
    var out = [];
    for (var i = 0; i < cache.length; i++) {
        if (runCoversAnyAlias(cache[i].scriptRuns, aliasPaths)) { out.push(cache[i].file); }
    }
    return out;
}

// Union two transcript-path lists, deduped and sorted.
function unionSortedFiles(a, b) {
    var seen = {};
    var out = [];
    a.concat(b).forEach(function (f) { if (!seen[f]) { seen[f] = true; out.push(f); } });
    return out.sort();
}

// Discover every referencing transcript for the alias set (touch-based), plus any
// transcript whose recorded script run covers the alias (the bridge), read each to text
// (for the git rung) and extract its file events. Returns events + texts + jsonls.
function gatherEventsForAliases(aliasPaths, projectsDir, cache, snapshotsDir) {
    var referencing = transcriptDiscovery.findReferencingJsonls(aliasPaths, projectsDir, cache);
    var jsonls = unionSortedFiles(referencing, jsonlsWithCoveringRuns(cache, aliasPaths));
    var events = [];
    var transcriptTexts = [];
    for (var i = 0; i < jsonls.length; i++) {
        transcriptTexts.push(fs.readFileSync(jsonls[i], 'utf8'));
        Array.prototype.push.apply(events, efe.extractFileEvents(jsonls[i], aliasPaths, snapshotsDir));
    }
    return { events: events, transcriptTexts: transcriptTexts, jsonls: jsonls };
}

// The distinct full paths that supplied at least one event (the canonical path
// plus any provenance-linked aliases). Surfaces how many locations contributed.
function computeContributingPaths(events) {
    var seen = {};
    var paths = [];
    for (var i = 0; i < events.length; i++) {
        var aliasPath = events[i].aliasPath;
        if (!aliasPath) { continue; }
        if (seen[aliasPath]) { continue; }
        seen[aliasPath] = true;
        paths.push(aliasPath);
    }
    return paths;
}

// True when a git seed was applied AND a post-seed Tier-1 beacon (Write or
// snapshot) follows it — the known Phase-1 limitation where applyWrite/
// applySnapshotVerify wipe the seeded belief. Lets the report flag a stale seed.
function detectSeedClobbered(events, gitSeedOption) {
    if (!gitSeedOption) { return false; }
    for (var i = 0; i < events.length; i++) {
        if (events[i].unixMs <= gitSeedOption.seedMs) { continue; }
        if (events[i].write) { return true; }
        if (events[i].snapshot) { return true; }
    }
    return false;
}

// Resolve the git seed for a repo-relative path at a commit, or null when no sha
// is given or the commit/path can't be read. Shape matches opts.gitSeed.
function resolveGitSeedForFile(repoRoot, sha, repoRelPath) {
    if (!sha) { return null; }
    var seed = gitSeed.resolveSeedFromCommit(repoRoot, sha, repoRelPath);
    if (!seed) { return null; }
    return { content: seed.content, seedMs: seed.seedMs, sha: sha };
}

// Build the seed-summary block attached to the result (applied flag, sha, instant,
// and how many post-seed events the engine replayed over the baseline).
function buildSeedSummary(events, gitSeedOption) {
    if (!gitSeedOption) { return { applied: false, sha: null, seedMs: null, postSeedEventCount: 0 }; }
    return {
        applied: true,
        sha: gitSeedOption.sha,
        seedMs: gitSeedOption.seedMs,
        postSeedEventCount: gitSeed.filterEventsAfter(events, gitSeedOption.seedMs).length
    };
}

// Flat newest-by-time roll-up of every timeline entry the matcher tagged, so the
// report/CLI can list matched commits without walking the per-entry timeline.
function collectCommitMatchesFromTimeline(timeline) {
    var out = [];
    var keys = Object.keys(timeline);
    for (var k = 0; k < keys.length; k++) {
        var entry = timeline[keys[k]];
        if (!entry.matchingCommits) { continue; }
        for (var m = 0; m < entry.matchingCommits.length; m++) {
            var commit = entry.matchingCommits[m];
            out.push({ sha: commit.sha, shortSha: commit.shortSha, unixMs: Number(keys[k]), timestamp: entry.timestamp });
        }
    }
    return out;
}

// Reconstruct one repo-relative file's line history from a preloaded corpus
// cache. The file is identified by its canonical full path; cross-copy evidence
// merges ONLY through recorded cp/mv lineage (no root inference). Returns the
// engine result with contributingPaths, seedClobbered, and seed attached.
function reconstructFileWithSeed(opts) {
    var repoRoot = opts.repoRoot;
    var repoRelPath = opts.repoRelPath;
    var snapshotsDir = opts.snapshotsDir ? opts.snapshotsDir : null;
    var canonical = path.join(repoRoot, repoRelPath);
    var allOps = lineage.gatherAllOps(opts.cache);
    var lineageGraph = lineage.buildLineageGraph(allOps);
    var seeds = buildSeedAliases(canonical, lineageGraph);
    var windows = aliasWindows.resolveAliasWindows(seeds, allOps);
    var aliasPaths = Array.from(windows.keys());
    var gathered = gatherEventsForAliases(aliasPaths, opts.projectsDir, opts.cache, snapshotsDir);
    var events = aliasWindows.filterEventsByAliasWindows(gathered.events, windows);
    var reference = chooseReference(canonical, events, aliasPaths, gathered.transcriptTexts);
    var gitSeedOption = resolveGitSeedForFile(repoRoot, opts.sha, repoRelPath);
    var committedVersions = gitCommitMatches.collectCommittedFileVersions(repoRoot, repoRelPath);
    var committedVersionMatcher = gitCommitMatches.buildCommittedVersionMatcher(committedVersions);
    var trackOptions = { filePath: canonical, aliasPaths: aliasPaths, jsonlsScanned: gathered.jsonls, reference: reference, committedVersionMatcher: committedVersionMatcher };
    if (gitSeedOption) { trackOptions.gitSeed = gitSeedOption; }
    var result = tls.trackLineStates(events, trackOptions);
    result.contributingPaths = computeContributingPaths(events);
    result.seedClobbered = detectSeedClobbered(events, gitSeedOption);
    result.seed = buildSeedSummary(events, gitSeedOption);
    result.commitMatches = collectCommitMatchesFromTimeline(result.timeline);
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadCombinedCache: loadCombinedCache,
        collectDistinctTouchedPaths: collectDistinctTouchedPaths,
        buildSeedAliases: buildSeedAliases,
        chooseReference: chooseReference,
        reconstructFileWithSeed: reconstructFileWithSeed
    };
}
