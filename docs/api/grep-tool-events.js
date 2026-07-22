// grep-tool-events: emission of grepMatches events (the sidecar event representation).
// Mirrors bash-op-events — derives the session cwd from the transcript, resolves each
// content-mode Grep result row's relative path against it, and emits ONE event per
// (result × distinct resolved file) whose resolved path is one of the file's alias paths.
// Geometry-free: materialize re-selects this file's rows from the result record.

var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
var resolveAgainstCwd = require('./file-historical-lineage').resolveAgainstCwd;
var createKindEvent = require('./file-event-kinds').createKindEvent;
var extractGrepToolResults = require('./grep-tool-results').extractGrepToolResults;

// The distinct resolved absolute paths from a result's rows, in first-seen order.
function distinctResolvedPaths(rows, cwd) {
  var seen = {};
  var paths = [];
  for (var i = 0; i < rows.length; i++) {
    var abs = resolveAgainstCwd(cwd, rows[i].relPath);
    if (seen[abs]) { continue; }
    seen[abs] = true;
    paths.push(abs);
  }
  return paths;
}

// One grepMatches event per resolved alias file of a single grep result, at the result's
// line/timestamp. The sub-object stores filePath (the resolved absolute path of THIS
// event's file) and cwd (so materialize can re-resolve the multi-file rows).
function extractEventsFromGrepToolResult(jsonlPath, result, aliasSet, cwd) {
  var paths = distinctResolvedPaths(result.rows, cwd);
  var events = [];
  for (var i = 0; i < paths.length; i++) {
    if (!aliasSet.has(paths[i])) { continue; }
    var grepEvent = createKindEvent(jsonlPath, result.resultLine, result.timestamp, 'grepMatches', { filePath: paths[i], cwd: cwd });
    grepEvent.aliasPath = paths[i];
    events.push(grepEvent);
  }
  return events;
}

// Every grepMatches event for this file from one transcript. cwd is derived internally
// (no plumbing from the caller); parsed is the already-parsed record array.
function grepMatchEventsForFile(jsonlPath, jsonlText, parsed, aliasSet) {
  var cwd = extractSessionMetadata(jsonlText).cwd;
  var results = extractGrepToolResults(parsed);
  var events = [];
  for (var i = 0; i < results.length; i++) {
    Array.prototype.push.apply(events, extractEventsFromGrepToolResult(jsonlPath, results[i], aliasSet, cwd));
  }
  return events;
}

module.exports = {
  grepMatchEventsForFile: grepMatchEventsForFile
};
