// bash-read-touches: the DISCOVERY counterpart to bash-read-events (which does
// per-line emission). collectBashReadTouches pairs each parseable Bash-read
// tool_use (head / tail / sed -n / wc -l / grep -n) with its tool_result by id
// and emits ONE coarse {kind:'bashread', path, line} touch per pair, so a
// transcript that ONLY bash-reads a file still discovers it — mirrors
// collectGrepTouches in grep-tool-results. `line` anchors at the tool_result
// record's 0-based parsed index, which stampTouchTimestamps reads to stamp the
// touch's timestamp (only result records carry timestamps). No stdout/validity/
// aliasSet guards: discovery only — the path is known from the command, and the
// result is paired purely to anchor the timestamp. A read with no paired result
// emits nothing (mirrors grep dropping unpaired/timestampless results).

var parseBashReadCommand = require('./bash-read-commands').parseBashReadCommand;

// resolveAgainstCwd lives in file-historical-lineage, which load-time requires
// THIS module (for collectBashReadTouches). A load-time require back would
// capture a stale export, so it is fetched at CALL time — mirrors getResolver() in
// grep-tool-results.
function getResolver() { return require('./file-historical-lineage').resolveAgainstCwd; }

// The tool_use/tool_result items of a record's message, or null.
function getMessageContent(record) {
  if (!record) { return null; }
  if (!record.message) { return null; }
  if (!Array.isArray(record.message.content)) { return null; }
  return record.message.content;
}

// Stash a parseable Bash-read command keyed by its tool_use id (mirrors
// bash-read-events.registerBashRead). Non-Bash / unparseable uses are skipped.
function registerBashRead(item, pending) {
  if (!item) { return; }
  if (item.type !== 'tool_use') { return; }
  if (item.name !== 'Bash') { return; }
  if (!item.input) { return; }
  var parsedCmd = parseBashReadCommand(item.input.command);
  if (!parsedCmd) { return; }
  pending[item.id] = parsedCmd;
}

// One {kind:'bashread', path, line} touch when a tool_result closes a pending
// Bash-read id, else null. path is the command's raw path resolved against cwd;
// line is the result record's 0-based parsed index (what stampTouchTimestamps
// reads). The closed id is consumed so it cannot pair twice.
function buildTouchFromToolResult(item, resultIndex, pending, cwd, resolveAgainstCwd) {
  if (!item) { return null; }
  if (item.type !== 'tool_result') { return null; }
  var parsedCmd = pending[item.tool_use_id];
  if (!parsedCmd) { return null; }
  delete pending[item.tool_use_id];
  return { kind: 'bashread', path: resolveAgainstCwd(cwd, parsedCmd.path), line: resultIndex };
}

// Resolved 'bashread' touches for discovery: one per paired Bash-read command,
// so a file that was only bash-read (never edited/grepped) is still discoverable
// for its transcript. One pass: register each use, try to close on each result.
function collectBashReadTouches(parsed, cwd) {
  var resolveAgainstCwd = getResolver();
  var pending = {};
  var touches = [];
  for (var i = 0; i < parsed.length; i++) {
    var content = getMessageContent(parsed[i]);
    if (!content) { continue; }
    for (var c = 0; c < content.length; c++) {
      registerBashRead(content[c], pending);
      var touch = buildTouchFromToolResult(content[c], i, pending, cwd, resolveAgainstCwd);
      if (touch) { touches.push(touch); }
    }
  }
  return touches;
}

module.exports = {
  collectBashReadTouches: collectBashReadTouches
};
