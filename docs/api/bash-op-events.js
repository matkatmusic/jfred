// bash-op-events: emission of the Bash-file-op event kinds (the sidecar event
// representation). Mirrors extractOriginalFileEventsFromEdits — consumes the (frozen,
// probe-reachable) extract-bash-file-ops parser read-only, resolves each op's
// path against the session cwd (resolveAgainstCwd), and emits one kind event
// per op whose resolved path is one of the file's alias paths:
//   rm          -> bashRm       (Tier-2 absence)
//   `>` / `>>`  -> bashTruncate / bashAppend (added in later phases)
// Content extraction for redirects lives in bash-op-evidence; emission only
// DECIDES extractability (skip a redirect whose content can't be recovered).

var extractBashFileOps = require('./extract-bash-file-ops').extractBashFileOps;
var resolveAgainstCwd = require('./file-historical-lineage').resolveAgainstCwd;
var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
var createKindEvent = require('./file-event-kinds').createKindEvent;
var bashOpEvidence = require('./bash-op-evidence');
var findBashCommandItem = bashOpEvidence.findBashCommandItem;
var redirectContentFromCommand = bashOpEvidence.redirectContentFromCommand;

// ISO timestamp of the record at a parsed index, or null. A record without one
// can't join the time-keyed timeline — its op is dropped (same guard the
// read/cat/edit extractors use). Local copy: importing it from
// file-events-extractors would form a cycle (that module imports this one).
function timestampAt(parsed, index) {
  var record = parsed[index];
  if (!record) { return null; }
  return record.timestamp ? record.timestamp : null;
}

// bashRm events for one rm op: one per removed path that is an alias of this
// file (resolved against cwd). Multiple paths in one `rm` each get their own
// event at the shared record coordinate.
function extractRmEvents(jsonlPath, parsed, op, aliasSet, cwd) {
  var iso = timestampAt(parsed, op.line);
  if (!iso) { return []; }
  var events = [];
  for (var i = 0; i < op.paths.length; i++) {
    var resolved = resolveAgainstCwd(cwd, op.paths[i]);
    if (!aliasSet.has(resolved)) { continue; }
    var rmEvent = createKindEvent(jsonlPath, op.line + 1, iso, 'bashRm', {});
    rmEvent.aliasPath = resolved;
    events.push(rmEvent);
  }
  return events;
}

// `>` is a truncate-write, `>>` an append.
function redirectKindForMode(mode) {
  if (mode === '>>') { return 'bashAppend'; }
  return 'bashTruncate';
}

// bashTruncate/bashAppend event for one redirect op of an alias path with
// extractable content (skip when content can't be safely recovered). Kind
// fields are {} — content is re-derived at materialize, mirroring originalFile.
function redirectEventForOp(jsonlPath, parsed, op, aliasSet, cwd) {
  var iso = timestampAt(parsed, op.line);
  if (!iso) { return []; }
  var resolved = resolveAgainstCwd(cwd, op.path);
  if (!aliasSet.has(resolved)) { return []; }
  var item = findBashCommandItem(parsed[op.line]);
  if (!item) { return []; }
  if (!redirectContentFromCommand(item.command)) { return []; }
  var redirectEvent = createKindEvent(jsonlPath, op.line + 1, iso, redirectKindForMode(op.mode), {});
  redirectEvent.aliasPath = resolved;
  return [redirectEvent];
}

// Events for one bash op, by type (non-emitting types -> []).
function extractEventsFromBashFileOp(jsonlPath, parsed, op, aliasSet, cwd) {
  if (op.type === 'rm') { return extractRmEvents(jsonlPath, parsed, op, aliasSet, cwd); }
  if (op.type === 'redirect') { return redirectEventForOp(jsonlPath, parsed, op, aliasSet, cwd); }
  return [];
}

// Every Bash-file-op event for this file from one transcript. jsonlText feeds
// the session-cwd lookup; parsed is the already-parsed record array.
function extractBashOpEvents(jsonlPath, jsonlText, parsed, aliasSet) {
  var cwd = extractSessionMetadata(jsonlText).cwd;
  var ops = extractBashFileOps(parsed);
  var events = [];
  for (var i = 0; i < ops.length; i++) {
    Array.prototype.push.apply(events, extractEventsFromBashFileOp(jsonlPath, parsed, ops[i], aliasSet, cwd));
  }
  return events;
}

module.exports = {
  extractBashOpEvents: extractBashOpEvents
};
