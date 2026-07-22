// One file's identity across renames/copies/moves.
// Permissive file-touch collector + cross-JSONL rename-lineage tracker.
// "Touched" = a session READ (Read tool / cat) OR MODIFIED (Write/Edit/create/
// update/cp/mv/git mv/rm/redirect) a file; lineage-aware so renames survive.
// Reuses existing extractors (does NOT re-parse tool records):
//   read-event-scanner    — ALL reads, unfiltered (chunkEventToEditRecord shape)
//   extractEditsFromJSONL — create/update/edit/cat edits (heterogeneous output)
//   extractBashFileOps    — cp/mv/git-mv/rm/redirect bash operations
//   extractSessionMetadata— session cwd, to resolve relative bash paths

var path, os;
var scanReadEvents, chunkEventToEditRecord, extractEditsFromJSONL, extractBashFileOps;
var extractSessionMetadata, collectGrepTouches, collectBashReadTouches;
if (typeof module !== 'undefined' && typeof require === 'function') {
  path = require('path');
  os = require('os');
  scanReadEvents = require('./read-event-scanner').scanReadEvents;
  chunkEventToEditRecord = require('./read-event-scanner').chunkEventToEditRecord;
  extractEditsFromJSONL = require('./edit-stream-extraction').extractEditsFromJSONL;
  extractBashFileOps = require('./extract-bash-file-ops').extractBashFileOps;
  extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
  collectGrepTouches = require('./grep-tool-results').collectGrepTouches;
  collectBashReadTouches = require('./bash-read-touches').collectBashReadTouches;
}

// Bash op types that participate in lineage (rename/copy), vs. plain touches.
var LINEAGE_OP_TYPES = { cp: true, mv: true, 'git-mv': true };

// ─── Path resolution ────────────────────────────────────────────────────────

// Resolve a possibly-relative bash path to absolute against the session cwd.
// Expands a leading "~" to home first. Bash op src/dst/paths may be relative;
// reads/writes/cat already carry absolute paths.
function resolveAgainstCwd(cwd, p) {
  if (!p) { return p; }
  var expanded = p;
  if (p.charAt(0) === '~') { expanded = path.join(os.homedir(), p.slice(1)); }
  if (path.isAbsolute(expanded)) { return expanded; }
  return path.resolve(cwd || '', expanded);
}

// ─── Touch collection from a single JSONL ───────────────────────────────────

// Append read touches (unfiltered). The unified scanner's chunkEventToEditRecord
// derivation + null gate reproduce the legacy capture set (path + line) 1:1.
function appendReadTouches(touches, lines, parsed) {
  var records = scanReadEvents(lines, parsed);
  for (var i = 0; i < records.length; i++) {
    var readEdit = chunkEventToEditRecord(records[i]);
    if (!readEdit) { continue; }
    touches.push({ kind: 'read', path: readEdit.filePath, line: readEdit.line });
  }
}

// Map an edit's type to a touch kind, or null when it is not a touch.
// Read/cat-sourced edits are observations -> 'read'; create/update -> write,
// edit -> edit. Snapshot edits and raw bash-op objects are excluded here.
function classifyTouchKind(edit) {
  if (edit.source === 'snapshot') { return null; }
  if (!edit.filePath) { return null; }
  if (edit.source === 'read') { return 'read'; }
  if (edit.source === 'cat') { return 'read'; }
  if (edit.type === 'create') { return 'write'; }
  if (edit.type === 'update') { return 'write'; }
  if (edit.type === 'edit') { return 'edit'; }
  return null;
}

// Append write/edit/cat touches drawn from extractEditsFromJSONL. cat-sourced edits carry the
// RAW command path (possibly relative); resolve those against the session cwd before recording
// the touch. read/write/edit paths already arrive absolute and pass through unchanged.
function appendEditTouches(touches, jsonlText, cwd) {
  var edits = extractEditsFromJSONL(jsonlText);
  for (var i = 0; i < edits.length; i++) {
    var kind = classifyTouchKind(edits[i]);
    if (!kind) { continue; }
    var touchPath = edits[i].source === 'cat' ? resolveAgainstCwd(cwd, edits[i].filePath) : edits[i].filePath;
    touches.push({ kind: kind, path: touchPath, line: edits[i].line });
  }
}

// Append touches for each path removed by an rm op (paths may be relative).
function appendRmTouches(touches, op, cwd) {
  for (var i = 0; i < op.paths.length; i++) {
    touches.push({ kind: 'rm', path: resolveAgainstCwd(cwd, op.paths[i]), line: op.line });
  }
}

// Append touches for rm/redirect bash ops, resolving relative paths to absolute.
function appendBashOpTouches(touches, op, cwd) {
  if (op.type === 'rm') { appendRmTouches(touches, op, cwd); return; }
  if (op.type === 'redirect') {
    touches.push({ kind: 'redirect', path: resolveAgainstCwd(cwd, op.path), line: op.line });
  }
}

// Build a resolved lineage op (cp/mv/git-mv) with absolute src/dst, or null.
function buildLineageOp(op, cwd) {
  if (!LINEAGE_OP_TYPES[op.type]) { return null; }
  return { type: op.type, src: resolveAgainstCwd(cwd, op.src), dst: resolveAgainstCwd(cwd, op.dst), line: op.line };
}

// Parse every JSONL line once into an array of objects (null on bad line).
function parseRawLines(lines) {
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    try { parsed.push(JSON.parse(lines[i])); }
    catch (e) { parsed.push(null); }
  }
  return parsed;
}

// Annotate each touch with the ISO timestamp of its JSONL record (or null when
// the record has none). The touch's `line` is the index into the same
// filter(Boolean) line array that produced `parsed`, so parsed[line] is the
// originating record. Carrying the timestamp lets touches be ordered GLOBALLY
// across transcripts (line numbers are only comparable within one transcript).
function attachTouchTimestamps(touches, parsed) {
  for (var i = 0; i < touches.length; i++) {
    var record = parsed[touches[i].line];
    touches[i].timestamp = (record && record.timestamp) ? record.timestamp : null;
  }
}

// Collect every touch and rename/copy op from one JSONL transcript.
// Returns { sessionId, cwd, touches:[{kind,path,line,timestamp}], ops:[{type,src,dst,line,timestamp}] }.
// touches use absolute paths; ops are the cp/mv/git-mv records for lineage.
function collectTouches(jsonlText) {
  var lines = jsonlText.split('\n').filter(Boolean);
  var parsed = parseRawLines(lines);
  var meta = extractSessionMetadata(jsonlText);
  var cwd = meta.cwd || '';

  var touches = [];
  appendReadTouches(touches, lines, parsed);
  appendEditTouches(touches, jsonlText, cwd);
  Array.prototype.push.apply(touches, collectGrepTouches(parsed, cwd));
  Array.prototype.push.apply(touches, collectBashReadTouches(parsed, cwd));

  var ops = [];
  var bashOps = extractBashFileOps(parsed);
  for (var i = 0; i < bashOps.length; i++) {
    appendBashOpTouches(touches, bashOps[i], cwd);
    var lineageOp = buildLineageOp(bashOps[i], cwd);
    if (lineageOp) { ops.push(lineageOp); }
  }

  attachTouchTimestamps(touches, parsed);
  attachTouchTimestamps(ops, parsed);
  return { sessionId: meta.sessionId, cwd: cwd, touches: touches, ops: ops };
}

// ─── Lineage graph ──────────────────────────────────────────────────────────

// Ensure a node exists in the adjacency map and return its neighbor set.
function ensureNode(graph, key) {
  if (!graph[key]) { graph[key] = new Set(); }
  return graph[key];
}

// Add a directed edge from -> to in the adjacency map.
function addDirectedEdge(graph, from, to) {
  ensureNode(graph, from).add(to);
  ensureNode(graph, to);
}

// Build an adjacency map (absolute path -> neighbor Set) from rename/copy ops.
//   mv / git-mv : UNDIRECTED edge src <-> dst (same file identity).
//   cp          : DIRECTED edge dst -> src (copy->source); a target reaches its
//                 copy-source, never the reverse.
function buildLineageGraph(allOps) {
  var graph = {};
  for (var i = 0; i < allOps.length; i++) {
    var op = allOps[i];
    if (op.type === 'cp') { addDirectedEdge(graph, op.dst, op.src); continue; }
    addDirectedEdge(graph, op.src, op.dst);
    addDirectedEdge(graph, op.dst, op.src);
  }
  return graph;
}

// Visit a node's neighbors, enqueueing any not yet seen.
function visitNeighbors(current, graph, aliases, queue) {
  var neighbors = graph[current];
  if (!neighbors) { return; }
  var list = Array.from(neighbors);
  for (var n = 0; n < list.length; n++) {
    if (aliases.has(list[n])) { continue; }
    aliases.add(list[n]);
    queue.push(list[n]);
  }
}

// Transitive closure (BFS) of alias paths reachable from one or more seeds.
// Returns a Set of absolute alias paths, always including the seeds themselves.
function resolveAliases(seedPaths, graph) {
  var aliases = new Set();
  var queue = seedPaths.slice();
  for (var s = 0; s < seedPaths.length; s++) { aliases.add(seedPaths[s]); }
  while (queue.length > 0) {
    visitNeighbors(queue.shift(), graph, aliases, queue);
  }
  return aliases;
}

// Gather every lineage op across all cached JSONLs into one flat array.
function gatherAllOps(cache) {
  var allOps = [];
  for (var i = 0; i < cache.length; i++) {
    allOps = allOps.concat(cache[i].ops);
  }
  return allOps;
}

// ─── Edit↔alias-path membership ─────────────────────────────────────────────

// True when some alias path ends with "/<relativePath>" — the full relative
// path must match, so a mere shared basename is rejected.
function hasAliasPathEndingWith(aliasPaths, relativePath) {
  var suffix = '/' + relativePath;
  for (var i = 0; i < aliasPaths.length; i++) {
    if (aliasPaths[i].length <= suffix.length) { continue; }
    if (aliasPaths[i].lastIndexOf(suffix) === aliasPaths[i].length - suffix.length) { return true; }
  }
  return false;
}

// True when an edit belongs to this file: its FULL absolute path is in the
// alias set. Basename matching is exactly the collision bug v2 exists to kill.
// One exception: snapshot-sourced edits record REPO-RELATIVE paths, so they
// match by full path-suffix against the alias paths instead.
function doesEditBelongToFile(edit, aliasSet, aliasPaths) {
  if (!edit.filePath) { return false; }
  if (aliasSet.has(edit.filePath)) { return true; }
  if (edit.source !== 'snapshot') { return false; }
  return hasAliasPathEndingWith(aliasPaths, edit.filePath);
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolveAgainstCwd: resolveAgainstCwd,
    collectTouches: collectTouches,
    buildLineageGraph: buildLineageGraph,
    resolveAliases: resolveAliases,
    gatherAllOps: gatherAllOps,
    doesEditBelongToFile: doesEditBelongToFile
  };
}
