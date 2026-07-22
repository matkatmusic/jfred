// grep-tool-results: PURE parser for native Grep tool results (output_mode:"content",
// -n:true). parseGrepRows splits a `relpath:line:text` content block into line-addressed
// rows; extractGrepToolResults pairs each content-mode Grep tool_use with its tool_result
// (mirrors bash-read-events' pairing) and returns one {resultLine, timestamp, rows} per
// result. No IO — both callers (grep-tool-events emission, collectTouches discovery) pass
// the already-parsed record array. Mirrors grepEntries (bash-read-evidence) with a leading
// relpath capture; spans index into the content string (the "relpath:line:" prefix excluded).

// One {relPath, lineNum, text, startIndex, endIndex} entry from a matched grep row; the
// span covers the text AFTER the "relpath:line:" prefix (end exclusive). Extracted to keep
// the parseGrepRows loop shallow (mirrors buildNumberedEntry in line-state-evidence).
function buildGrepRow(match, rawLine, offset) {
  return {
    relPath: match[1],
    lineNum: parseInt(match[2], 10),
    text: rawLine.slice(match[0].length),
    startIndex: offset + match[0].length,
    endIndex: offset + rawLine.length
  };
}

// Entries for every numbered `relpath:line:text` / `relpath:line-text` row. The regex
// captures a non-greedy relpath, the absolute line number, then ":" (match row) or "-"
// (-A/-B/-C context row). Non-numbered rows (the "--" group separator, blanks) don't match
// and push nothing; offset still advances so spans stay aligned to contentText.
function parseGrepRows(contentText) {
  var rawLines = contentText.split('\n');
  var rows = [];
  var offset = 0;
  for (var i = 0; i < rawLines.length; i++) {
    var match = /^(.+?):(\d+)[:-]/.exec(rawLines[i]);
    if (match) { rows.push(buildGrepRow(match, rawLines[i], offset)); }
    offset += rawLines[i].length + 1;
  }
  return rows;
}

// The tool_use/tool_result items of a record's message, or null.
function getMessageContent(record) {
  if (!record) { return null; }
  if (!record.message) { return null; }
  if (!Array.isArray(record.message.content)) { return null; }
  return record.message.content;
}

// True for a content-mode, line-numbered Grep tool_use (output_mode:'content', -n:true).
function isContentGrepUse(item) {
  if (!item) { return false; }
  if (item.type !== 'tool_use') { return false; }
  if (item.name !== 'Grep') { return false; }
  if (!item.input) { return false; }
  if (item.input.output_mode !== 'content') { return false; }
  if (item.input['-n'] !== true) { return false; }
  return true;
}

// The set (id -> true) of qualifying content-mode Grep tool_use ids across parsed.
function collectGrepUseIds(parsed) {
  var ids = {};
  for (var i = 0; i < parsed.length; i++) {
    var content = getMessageContent(parsed[i]);
    if (!content) { continue; }
    for (var c = 0; c < content.length; c++) {
      if (isContentGrepUse(content[c])) { ids[content[c].id] = true; }
    }
  }
  return ids;
}

// One {resultLine (1-based), timestamp, rows} for a tool_result paired to a content-mode
// Grep use, or null. The result's string content is the relpath:line:text block; a result
// without a timestamp is dropped (can't join the time-keyed timeline).
function buildGrepResult(item, record, index, grepIds) {
  if (!item) { return null; }
  if (item.type !== 'tool_result') { return null; }
  if (!grepIds[item.tool_use_id]) { return null; }
  if (typeof item.content !== 'string') { return null; }
  if (!record.timestamp) { return null; }
  return { resultLine: index + 1, timestamp: record.timestamp, rows: parseGrepRows(item.content) };
}

// Every content-mode Grep result in a parsed transcript, paired use<->result by id. The
// resultLine is the result record's 1-based parsed index (matching createKindEvent's
// jsonlLine). Mirrors the bash-read-events pairing pass.
function extractGrepToolResults(parsed) {
  var grepIds = collectGrepUseIds(parsed);
  var results = [];
  for (var i = 0; i < parsed.length; i++) {
    var content = getMessageContent(parsed[i]);
    if (!content) { continue; }
    for (var c = 0; c < content.length; c++) {
      var result = buildGrepResult(content[c], parsed[i], i, grepIds);
      if (result) { results.push(result); }
    }
  }
  return results;
}

// resolveAgainstCwd lives in file-historical-lineage, which load-time requires THIS module
// (for collectGrepTouches). A load-time require back would capture a stale export, so it is
// fetched at CALL time — mirrors the lse() cycle break in bash-read-evidence.
function getResolver() { return require('./file-historical-lineage').resolveAgainstCwd; }

// One {kind:'grep', path, line} touch per row of a single grep result. line is the 0-based
// parsed index (resultLine - 1) that stampTouchTimestamps reads — appendReadTouches stores
// the same 0-based line. path is the row's relPath resolved to absolute.
function appendResultTouches(touches, result, cwd, resolveAgainstCwd) {
  for (var r = 0; r < result.rows.length; r++) {
    touches.push({ kind: 'grep', path: resolveAgainstCwd(cwd, result.rows[r].relPath), line: result.resultLine - 1 });
  }
}

// Resolved 'grep' touches for discovery: one per content-mode grep match row, so a file
// that was only grepped (never edited) is still discoverable for its transcript.
function collectGrepTouches(parsed, cwd) {
  var resolveAgainstCwd = getResolver();
  var results = extractGrepToolResults(parsed);
  var touches = [];
  for (var i = 0; i < results.length; i++) {
    appendResultTouches(touches, results[i], cwd, resolveAgainstCwd);
  }
  return touches;
}

module.exports = {
  parseGrepRows: parseGrepRows,
  extractGrepToolResults: extractGrepToolResults,
  collectGrepTouches: collectGrepTouches
};
