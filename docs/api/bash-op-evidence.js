// bash-op-evidence: materialization of the Bash-file-op event kinds (bashRm /
// bashTruncate / bashAppend) plus the conservative redirect-content parser
// (redirectContentFromCommand). Mirrors line-state-evidence's per-kind
// materializers but lives in its own module — the redirect-content parser would
// push line-state-evidence over the 250-line write cap, and the bash-op kinds
// form a cohesive cluster. Keeps api/extract-bash-file-ops.js byte-identical:
// that parser is probe-reachable; this content parser is sidecar-only.

var loadParsedRecord = require('./evidence-record-access').loadParsedRecord;

// line-state-evidence and this module form a require CYCLE: its materializeEventEvidence
// dispatches here, and the truncate/append materializers reuse its
// content-line + ref builders. Both modules reassign module.exports, so binding
// the dependency at LOAD time can capture a stale {} (whichever loads second
// wins). Resolve it at CALL time instead — by then the whole cluster is loaded.
function requireLineStateEvidence() { return require('./line-state-evidence'); }

// {index, command} of the first Bash tool_use in a record, or null. One
// tool_use per assistant record in practice — the same assumption the
// (frozen) extract-bash-file-ops parser already makes.
function findBashCommandItem(record) {
  if (!record) { return null; }
  if (!record.message) { return null; }
  var content = record.message.content;
  if (!Array.isArray(content)) { return null; }
  for (var j = 0; j < content.length; j++) {
    if (content[j].type !== 'tool_use') { continue; }
    if (content[j].name !== 'Bash') { continue; }
    if (!content[j].input) { continue; }
    return { index: j, command: content[j].input.command };
  }
  return null;
}

// rm: absence carries no per-line content — the evidence IS the command that
// removed the file (a textProperty span over the whole input.command string).
function materializeBashRmEvidence(event) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var item = findBashCommandItem(record);
  var property = 'message.content[' + item.index + '].input.command';
  var ref = requireLineStateEvidence().buildTextPropertyRef(event.jsonl, event.jsonlLine, property, 0, item.command.length);
  return { kind: 'bashRm', ref: ref };
}

// ─── Redirect content extraction (conservative) ──────────────────────────────

// The trailing `>/>> path` of a single-line redirect (mirrors the frozen
// parser's REDIRECT_PATTERN); stripping it leaves the producer command.
var REDIRECT_TAIL = /\s*>{1,2}\s*\S+\s*$/;
var ECHO_SQ = /^echo\s+'[^']*'$/;
var PRINTF_SQ = /^printf\s+'[^']*'$/;

// {content, startIndex, endIndex} of the single quoted token in a producer
// (exactly one '...' pair — the regexes guarantee it). Indices index the
// producer, which is a PREFIX of the command, so they index the command too.
function extractSingleQuotedSpan(producer) {
  var start = producer.indexOf("'");
  var end = producer.lastIndexOf("'");
  return { content: producer.slice(start + 1, end), startIndex: start + 1, endIndex: end };
}

// printf is literal ONLY when its format has no % and no backslash escape;
// otherwise the written bytes diverge from the command bytes (not extractable).
function isPrintfContentLiteral(content) {
  if (content.indexOf('%') !== -1) { return false; }
  if (content.indexOf('\\') !== -1) { return false; }
  return true;
}

// Empty content is dropped: echo '' writes a newline (a 1-line file) that an
// empty span can't represent, and printf '' is a degenerate 0-byte write.
function validateNonEmptySpan(span) {
  if (span.content === '') { return null; }
  return span;
}

function extractPrintfSpan(producer) {
  var span = extractSingleQuotedSpan(producer);
  if (!isPrintfContentLiteral(span.content)) { return null; }
  return validateNonEmptySpan(span);
}

// Content written by a redirect, with its span in the command, or null.
// CONSERVATIVE: only single-quoted echo (bash leaves single quotes literal) and
// literal printf — a missing observation is safe, a wrong one corrupts belief
// (the EOF-caution principle). Heredocs never reach here: the frozen redirect
// parser only matches a command ENDING in `>/>> path`, which a heredoc body does not.
function redirectContentFromCommand(command) {
  if (typeof command !== 'string') { return null; }
  if (!REDIRECT_TAIL.test(command)) { return null; }
  var producer = command.replace(REDIRECT_TAIL, '');
  if (ECHO_SQ.test(producer)) { return validateNonEmptySpan(extractSingleQuotedSpan(producer)); }
  if (PRINTF_SQ.test(producer)) { return extractPrintfSpan(producer); }
  return null;
}

// ─── Redirect materialization (truncate / append) ────────────────────────────

// Shift each buildPlainLineEntries span by where the content sits in the command.
function applyOffsetToEntries(entries, base) {
  return entries.map(function (entry) {
    return { lineNum: entry.lineNum, text: entry.text, startIndex: entry.startIndex + base, endIndex: entry.endIndex + base };
  });
}

// byLine {lineNum, text, ref} for a redirect: split the extracted content into
// lines (numbered from 1) and ref each into input.command at its offset span.
function redirectByLine(event, item, span) {
  var property = 'message.content[' + item.index + '].input.command';
  var entries = applyOffsetToEntries(requireLineStateEvidence().buildPlainLineEntries(span.content), span.startIndex);
  return requireLineStateEvidence().pairEntriesWithReferences(event, property, entries);
}

// `>`: the file IS the (re-derived) written content. byLine numbered from 1; the
// tracker overlays it and trims the tail (truncate-replace).
function materializeBashTruncateEvidence(event) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var item = findBashCommandItem(record);
  var span = redirectContentFromCommand(item.command);
  return { kind: 'bashTruncate', byLine: redirectByLine(event, item, span) };
}

// `>>`: the appended content. byLine numbered from 1 (RELATIVE); the apply
// branch offsets each line by the current extent (apply-time stateful).
function materializeBashAppendEvidence(event) {
  var record = loadParsedRecord(event.jsonl, event.jsonlLine);
  var item = findBashCommandItem(record);
  var span = redirectContentFromCommand(item.command);
  return { kind: 'bashAppend', byLine: redirectByLine(event, item, span) };
}

module.exports = {
  findBashCommandItem: findBashCommandItem,
  redirectContentFromCommand: redirectContentFromCommand,
  materializeBashRmEvidence: materializeBashRmEvidence,
  materializeBashTruncateEvidence: materializeBashTruncateEvidence,
  materializeBashAppendEvidence: materializeBashAppendEvidence
};
