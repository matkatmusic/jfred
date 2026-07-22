// bash-read-events: emission of the partial-content Bash-read event kinds. A
// Bash command (tool_use, input.command) and its output (tool_result, stdout)
// live in TWO SEPARATE JSONL records linked by tool_use_id, so this module pairs
// them in one pass and emits the event at the RESULT record's 1-based index with
// the RESULT record's timestamp. ALL geometry is computed HERE (the materializer
// sees only the result record) and carried on the sub-object.
//
// Imports are one-way (none of these require this module): createKindEvent from
// file-event-kinds, splitContentIntoLineSpans from line-state-evidence, parseBashReadCommand
// from bash-read-commands. The pairing loop and stdout-validity guards mirror
// scanToolUseResults / isValidReadContent / confirmCatResult in
// file-event-observations (that file is over the 250-line cap, so its unexported
// helpers are replicated here, not imported).

var createKindEvent = require('./file-event-kinds').createKindEvent;
var splitContentIntoLineSpans = require('./line-state-evidence').splitContentIntoLineSpans;
var parseBashReadCommand = require('./bash-read-commands').parseBashReadCommand;
var resolveAgainstCwd = require('./file-historical-lineage').resolveAgainstCwd;
var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;

// ISO timestamp of the record at a parsed index, or null. Local copy: importing
// recordTimestampAt from file-events-extractors would form a require cycle (that
// module imports this one). Mirrors bash-op-events.timestampAt.
function timestampAt(parsed, index) {
  var record = parsed[index];
  if (!record) { return null; }
  return record.timestamp ? record.timestamp : null;
}

function getMessageContent(record) {
  if (!record) { return null; }
  if (!record.message) { return null; }
  if (!Array.isArray(record.message.content)) { return null; }
  return record.message.content;
}

// Stash a parseable Bash read command keyed by its tool_use id.
function registerBashRead(item, pending) {
  if (!item) { return; }
  if (item.type !== 'tool_use') { return; }
  if (item.name !== 'Bash') { return; }
  if (!item.input) { return; }
  var parsedCmd = parseBashReadCommand(item.input.command);
  if (!parsedCmd) { return; }
  pending[item.id] = parsedCmd;
}

// Result stdout: the tool_result item's string content, else toolUseResult.stdout
// (mirrors confirmCatResult).
function readResultStdout(item, record) {
  if (typeof item.content === 'string') {
    if (item.content) { return item.content; }
  }
  if (!record) { return ''; }
  if (!record.toolUseResult) { return ''; }
  return record.toolUseResult.stdout || '';
}

// Replicates isValidReadContent: reject empty or harness-error stdout so a
// mispositioned/garbage overlay is never emitted.
function isValidStdout(stdout) {
  if (!stdout) { return false; }
  if (stdout.indexOf('Wasted call') === 0) { return false; }
  if (stdout.indexOf('Error') === 0) { return false; }
  if (stdout.indexOf('File does not exist') === 0) { return false; }
  return true;
}

// The kind sub-object for a matched read. bashReadChunk proves EOF when it
// returned FEWER lines than asked (reads-to-EOF forms have requested === null,
// so they always prove EOF). Other kinds ({} ) arrive in later phases.
function buildBashReadChunkSubEvent(parsedCmd, lineCount) {
  if (parsedCmd.kind === 'bashReadChunk') {
    var hitEof = parsedCmd.requested === null ? true : lineCount < parsedCmd.requested;
    return { firstLine: parsedCmd.firstLine, lineCount: lineCount, hitEof: hitEof };
  }
  return {};
}

// One event from a tool_result that matches a pending read command, or null.
function emitResultEvent(item, record, resultIndex, ctx) {
  if (!item) { return null; }
  if (item.type !== 'tool_result') { return null; }
  var parsedCmd = ctx.pending[item.tool_use_id];
  if (!parsedCmd) { return null; }
  delete ctx.pending[item.tool_use_id];
  var resolved = resolveAgainstCwd(ctx.cwd, parsedCmd.path);
  if (!ctx.aliasSet.has(resolved)) { return null; }
  if (item.is_error === true) { return null; }
  var stdout = readResultStdout(item, record);
  if (!isValidStdout(stdout)) { return null; }
  var lineCount = splitContentIntoLineSpans(stdout).length;
  if (lineCount === 0) { return null; }
  var iso = timestampAt(ctx.parsed, resultIndex);
  if (!iso) { return null; }
  var readEvent = createKindEvent(ctx.jsonlPath, resultIndex + 1, iso, parsedCmd.kind, buildBashReadChunkSubEvent(parsedCmd, lineCount));
  readEvent.aliasPath = resolved;
  return readEvent;
}

// Every partial-read event for this file from one transcript. jsonlText is USED
// for the session-cwd lookup; each raw read path (bashReadChunk/bashExtent/
// bashGrep) is resolved against that cwd before the aliasSet match.
function extractBashReadEvents(jsonlPath, jsonlText, parsed, aliasSet) {
  var cwd = extractSessionMetadata(jsonlText).cwd;
  var ctx = { jsonlPath: jsonlPath, parsed: parsed, aliasSet: aliasSet, pending: {}, cwd: cwd };
  var events = [];
  for (var i = 0; i < parsed.length; i++) {
    var content = getMessageContent(parsed[i]);
    if (!content) { continue; }
    for (var c = 0; c < content.length; c++) {
      registerBashRead(content[c], ctx.pending);
      var event = emitResultEvent(content[c], parsed[i], i, ctx);
      if (event) { events.push(event); }
    }
  }
  return events;
}

module.exports = {
  extractBashReadEvents: extractBashReadEvents
};
