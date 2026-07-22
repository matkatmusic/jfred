// Per-run file-path-history index + earliest/current-path resolvers.
//
// Builds ONE index over every transcript in a projects folder, then answers two
// per-file questions used by the probe's emitted record fields:
//   - findEarliestFilePath  — the file's first-known absolute path (earliestSeenFullPath)
//   - findCurrentOnDiskPath  — where the file lives on disk now    (lastSeenFullPath)
// Both follow the file's whole rename/move/copy history (so an old path and its
// renamed path count as the same file). Reuses the transcript scan in
// transcript-discovery.js and the lineage primitives in
// file-historical-lineage.js so the per-run scan lives in one place.

var fs;
var loadAllJsonlFilesInProjectsFolder, gatherAllOps, buildLineageGraph, resolveAliases;
if (typeof module !== 'undefined' && typeof require === 'function') {
  fs = require('fs');
  loadAllJsonlFilesInProjectsFolder =
    require('./transcript-discovery').loadAllJsonlFilesInProjectsFolder;
  var lineage = require('./file-historical-lineage');
  gatherAllOps = lineage.gatherAllOps;
  buildLineageGraph = lineage.buildLineageGraph;
  resolveAliases = lineage.resolveAliases;
}

// ─── Build the once-per-run index ────────────────────────────────────────────

// Group every touch from every transcript by its absolute path, keeping each
// touch's ordering keys (timestamp, line). Returns { path -> [{timestamp,line}] }.
function groupTouchesByPath(cache) {
  var touchesByPath = {};
  for (var i = 0; i < cache.length; i++) {
    var touches = cache[i].touches;
    for (var t = 0; t < touches.length; t++) {
      var p = touches[t].path;
      if (!touchesByPath[p]) { touchesByPath[p] = []; }
      touchesByPath[p].push({ timestamp: touches[t].timestamp, line: touches[t].line });
    }
  }
  return touchesByPath;
}

// Build the once-per-run index over ALL transcripts in projectsDir:
//   samePathGraph — rename/move/copy graph (a path reaches every other path that
//                   refers to the same file across mv/git-mv/cp).
//   touchesByPath — absolute path -> array of {timestamp,line} touches.
// Pass the returned index to findEarliestFilePath / findCurrentOnDiskPath.
// cache is optional: pass a pre-loaded loadAllJsonlFilesInProjectsFolder result
// to reuse one scan across callers; omitted, the folder is scanned here.
function buildFilePathHistoryIndex(projectsDir, cache) {
  cache = cache || loadAllJsonlFilesInProjectsFolder(projectsDir);
  return {
    samePathGraph: buildLineageGraph(gatherAllOps(cache)),
    touchesByPath: groupTouchesByPath(cache)
  };
}

// ─── Touch ordering ──────────────────────────────────────────────────────────

// Order two touches by (timestamp ascending, then line ascending). A present
// timestamp always sorts before a missing one; missing-vs-missing falls back to
// line (only meaningful within one transcript, used purely as a tie-break).
// Returns <0 when a is earlier, >0 when a is later, 0 when equal.
function compareTouchOrder(a, b) {
  if (a.timestamp && b.timestamp) {
    if (a.timestamp < b.timestamp) { return -1; }
    if (a.timestamp > b.timestamp) { return 1; }
    return a.line - b.line;
  }
  if (a.timestamp && !b.timestamp) { return -1; }
  if (!a.timestamp && b.timestamp) { return 1; }
  return a.line - b.line;
}

// The earliest touch in a list, by (timestamp, line), or null when empty.
function findEarliestTouch(touches) {
  if (!touches || touches.length === 0) { return null; }
  var earliest = touches[0];
  for (var i = 1; i < touches.length; i++) {
    if (compareTouchOrder(touches[i], earliest) < 0) { earliest = touches[i]; }
  }
  return earliest;
}

// The most-recent touch in a list, by (timestamp, line). Assumes a non-empty list.
function findLatestTouch(touches) {
  var latest = touches[0];
  for (var i = 1; i < touches.length; i++) {
    if (compareTouchOrder(touches[i], latest) > 0) { latest = touches[i]; }
  }
  return latest;
}

// ─── Per-file resolvers ──────────────────────────────────────────────────────

// Every path the file has ever had (its path history), as an array — the query
// paths plus everything reachable through the rename/move/copy graph.
function resolveAllPathsForFile(knownFilePaths, index) {
  return Array.from(resolveAliases(knownFilePaths, index.samePathGraph));
}

// The earliest-ever recorded absolute path for a file, across ALL transcripts
// and across its whole rename/move/copy history. Ordered by (timestamp, line).
// Falls back to the first known path when no touch was recorded for any alias.
function findEarliestFilePath(knownFilePaths, index) {
  var aliasPaths = resolveAllPathsForFile(knownFilePaths, index);
  var earliest = null;
  var earliestPath = knownFilePaths.length > 0 ? knownFilePaths[0] : '';
  for (var a = 0; a < aliasPaths.length; a++) {
    var candidate = findEarliestTouch(index.touchesByPath[aliasPaths[a]]);
    if (candidate === null) { continue; }
    if (earliest === null || compareTouchOrder(candidate, earliest) < 0) {
      earliest = candidate;
      earliestPath = aliasPaths[a];
    }
  }
  return earliestPath;
}

// Where the file exists on disk NOW, after following its rename/move/copy
// history: of all the file's paths that fs.existsSync, the one most-recently
// touched (by timestamp, line). Returns "" when no alias exists on disk (deleted).
function findCurrentOnDiskPath(knownFilePaths, index) {
  var aliasPaths = resolveAllPathsForFile(knownFilePaths, index);
  var best = null;
  var bestPath = '';
  for (var a = 0; a < aliasPaths.length; a++) {
    var p = aliasPaths[a];
    if (!fs.existsSync(p)) { continue; }
    var touches = index.touchesByPath[p];
    var recency = touches ? findLatestTouch(touches) : { timestamp: null, line: 0 };
    if (best === null || compareTouchOrder(recency, best) > 0) {
      best = recency;
      bestPath = p;
    }
  }
  return bestPath;
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildFilePathHistoryIndex: buildFilePathHistoryIndex,
    findEarliestFilePath: findEarliestFilePath,
    findCurrentOnDiskPath: findCurrentOnDiskPath,
    compareTouchOrder: compareTouchOrder
  };
}
