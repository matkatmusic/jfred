// Time-aware alias membership for mid-timeline renames/copies (roadmap item 10).
//
// A window is the LATEST unixMs at which a path is a valid alias of the seed.
// Infinity = never cut (the seed itself, and mv/git-mv same-identity paths). The
// lower bound is unmodeled (always -Infinity) — see the plan's "Known limitations".
//
// `cp src dst` copies src into dst at ONE instant T, then they diverge; a src
// event counts toward dst's belief only THROUGH T (the upper bound). mv/git-mv
// is a rename (same bytes), so it never cuts. This module layers ALONGSIDE the
// flat lineage exports in file-historical-lineage.js (which the probe depends on
// and must stay byte-identical); it never modifies them.

// The copy instant of a cp op, or Infinity (no cut) when the op carries no usable
// timestamp. Cutting to NaN would make every `unixMs <= NaN` false and silently
// drop ALL of the destination's events — worse than the un-windowed bug (A1 fix).
function copyInstantMs(op) {
  if (!op.timestamp) { return Infinity; }
  var ms = Date.parse(op.timestamp);
  if (isNaN(ms)) { return Infinity; }
  return ms;
}

// Build relaxation edges from stamped lineage ops.
//   cp        : directed dst -> src with the copy-instant cut (a target reaches
//               its copy-source, valid only through the copy instant).
//   mv/git-mv : undirected src <-> dst with no cut (same identity / same bytes).
function buildWindowedEdges(stampedOps) {
  var edges = [];
  for (var i = 0; i < stampedOps.length; i++) {
    var op = stampedOps[i];
    if (op.type === 'cp') {
      edges.push({ from: op.dst, to: op.src, cut: copyInstantMs(op) });
      continue;
    }
    edges.push({ from: op.src, to: op.dst, cut: Infinity });
    edges.push({ from: op.dst, to: op.src, cut: Infinity });
  }
  return edges;
}

// Relax one neighbor to `candidate`, lowering its bound and re-enqueueing when
// the candidate is tighter. Seeds are never relaxed below Infinity (a
// `cp seed downstream` edge must not cut the file we are tracking).
function relaxNeighborWindow(neighbor, candidate, windows, queue, seedSet) {
  if (seedSet.has(neighbor)) { return; }          // seeds are valid for all time
  if (!windows.has(neighbor)) {
    windows.set(neighbor, candidate);
    queue.push(neighbor);
    return;
  }
  if (candidate < windows.get(neighbor)) {        // tightest wins (conservative)
    windows.set(neighbor, candidate);
    queue.push(neighbor);
  }
}

// Relax every neighbor reachable from `current`, composing this node's bound with
// each edge's cut by minimum (the tightest instant along the path).
function relaxWindowFrom(current, edges, windows, queue, seedSet) {
  var currentBound = windows.get(current);
  for (var i = 0; i < edges.length; i++) {
    if (edges[i].from !== current) { continue; }
    relaxNeighborWindow(edges[i].to, Math.min(currentBound, edges[i].cut), windows, queue, seedSet);
  }
}

// BFS/relaxation from the seed(s) over lineage edges. Returns
// Map<absolutePath, latestValidMs>; the bound only ever decreases, so cycles
// (e.g. backup/restore) converge.
function resolveAliasWindows(seedPaths, stampedOps) {
  var edges = buildWindowedEdges(stampedOps);
  var windows = new Map();
  var seedSet = new Set(seedPaths);
  var queue = [];
  for (var s = 0; s < seedPaths.length; s++) {
    windows.set(seedPaths[s], Infinity);
    queue.push(seedPaths[s]);
  }
  while (queue.length > 0) {
    relaxWindowFrom(queue.shift(), edges, windows, queue, seedSet);
  }
  return windows;
}

// True when `absolutePath` is a valid alias at `unixMs`. Permissive when no
// windows are supplied (existing tests / trackFixture). Upper bound INCLUSIVE
// (the copy reads source state AT the instant T).
function isAliasPathValidAtTimestamp(aliasWindows, absolutePath, unixMs) {
  if (!aliasWindows) { return true; }
  if (!aliasWindows.has(absolutePath)) { return false; }
  if (unixMs <= aliasWindows.get(absolutePath)) { return true; }
  return false;
}

// Keep only events whose annotated aliasPath is a valid alias at the event's
// time. Pure: events carry their matched aliasPath (set at emission) + unixMs.
function filterEventsByAliasWindows(events, aliasWindows) {
  var kept = [];
  for (var i = 0; i < events.length; i++) {
    if (isAliasPathValidAtTimestamp(aliasWindows, events[i].aliasPath, events[i].unixMs)) {
      kept.push(events[i]);
    }
  }
  return kept;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolveAliasWindows: resolveAliasWindows,
    isAliasPathValidAtTimestamp: isAliasPathValidAtTimestamp,
    filterEventsByAliasWindows: filterEventsByAliasWindows
  };
}
