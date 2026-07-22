// bash-read-commands: pure, regex-isolated parsers for partial-content Bash
// "read" commands. parseBashReadCommand(cmd) returns ONE of:
//   { kind:'bashReadChunk', path, firstLine, requested }  — requested === null
//     for reads-to-EOF (`tail -n +N`, `sed -n 'A,$p'`); else the asked-for count.
//   null  — command is not a recognized partial read; skip it.
// No record/IO logic lives here. Every pattern is anchored ^...$ over the WHOLE
// command, so any command carrying a pipe or redirect fails to match and is
// skipped safely (the rabbit-hole of `cat -n x | head` etc. stays out).
//
// Deliberately SKIPPED (return null) — listed per the no-silent-caps rule:
//   - head -N / tail -N shorthand (e.g. `head -5`): un-flagged count form.
//   - tail -n N and bare `tail`: last-N, un-positionable without known extent.
//   - sed with -e / multiple scripts, or scripts other than Np / A,Bp / A,$p.
//   - byte modes (head -c), multi-file, piped, or redirected commands.
// Alias/path matching happens in the emission module — these parsers only
// recover the raw path argument (unquoted), mirroring extract-bash-file-ops.

var stripPathQuotes = require('./extract-bash-file-ops').stripPathQuotes;

var HEAD_PATTERN = /^head\s+(?:-n\s*(\d+)\s+)?(\S+)$/;
var SED_PATTERN = /^sed\s+-n\s+(\S+)\s+(\S+)$/;
var TAIL_PATTERN = /^tail\s+-n\s*\+(\d+)\s+(\S+)$/;
var WC_PATTERN = /^wc\s+-l\s+(\S+)$/;

// The GNU/BSD default line count for a head with no -n flag.
var HEAD_DEFAULT_LINES = 10;

function readChunk(rawPath, firstLine, requested) {
  return { kind: 'bashReadChunk', path: stripPathQuotes(rawPath), firstLine: firstLine, requested: requested };
}

// head [-n N] file -> N lines (default 10) from line 1.
function parseHead(cmd) {
  var m = HEAD_PATTERN.exec(cmd);
  if (!m) { return null; }
  var requested = m[1] ? parseInt(m[1], 10) : HEAD_DEFAULT_LINES;
  return readChunk(m[2], 1, requested);
}

// Geometry of a sed -n script (already unquoted): {firstLine, requested}, or null.
function parseSedScriptGeometry(script) {
  var single = /^(\d+)p$/.exec(script);
  if (single) { return { firstLine: parseInt(single[1], 10), requested: 1 }; }
  var toEof = /^(\d+),\$p$/.exec(script);
  if (toEof) { return { firstLine: parseInt(toEof[1], 10), requested: null }; }
  var range = /^(\d+),(\d+)p$/.exec(script);
  if (!range) { return null; }
  var a = parseInt(range[1], 10);
  var b = parseInt(range[2], 10);
  if (b < a) { return null; }
  return { firstLine: a, requested: b - a + 1 };
}

// sed -n 'A,Bp' file (also Np, A,$p; quoted or bare) -> chunk from A.
function parseSed(cmd) {
  var m = SED_PATTERN.exec(cmd);
  if (!m) { return null; }
  var geom = parseSedScriptGeometry(stripPathQuotes(m[1]));
  if (!geom) { return null; }
  return readChunk(m[2], geom.firstLine, geom.requested);
}

// tail -n +N file -> from line N to EOF (requested irrelevant -> null).
function parseTail(cmd) {
  var m = TAIL_PATTERN.exec(cmd);
  if (!m) { return null; }
  return readChunk(m[2], parseInt(m[1], 10), null);
}

// wc -l file -> file extent (a LOWER BOUND; see the apply branch). Single file
// only; piped/redirected forms don't anchor to an alias and are skipped.
function parseWcOutput(cmd) {
  var m = WC_PATTERN.exec(cmd);
  if (!m) { return null; }
  return { kind: 'bashExtent', path: stripPathQuotes(m[1]) };
}

function isShortFlag(tok) {
  if (tok.length < 2) { return false; }
  if (tok.charAt(0) !== '-') { return false; }
  return tok.charAt(1) !== '-';
}

// A grep flag that disqualifies single-file parsing: recursive (-r/-R/--recursive,
// --include/--exclude imply a tree) or an arg-taking flag (-e/-f/-m) that shifts
// the pattern/file positions. Returns true -> skip the whole command.
function grepFlagDisqualifies(tok) {
  if (tok === '--recursive') { return true; }
  if (tok === '--include') { return true; }
  if (tok === '--exclude') { return true; }
  if (!isShortFlag(tok)) { return false; }
  if (/[rR]/.test(tok)) { return true; }
  if (/[efm]/.test(tok)) { return true; }
  return false;
}

// Single-file `grep -n PATTERN FILE` (incl -A/-B/-C context) -> bashGrep, else
// null. SKIPPED (return null): recursive/multi-file grep (item 5 — native Grep
// tool, file:line:text), no -n (no line numbers to recover), -e/-f/-m forms, and
// quoted patterns containing spaces (they split into extra tokens).
function parseGrep(cmd) {
  var tokens = cmd.split(/\s+/).filter(Boolean);
  if (tokens[0] !== 'grep') { return null; }
  var hasN = false;
  var i = 1;
  while (i < tokens.length) {
    if (tokens[i].charAt(0) !== '-') { break; }
    if (grepFlagDisqualifies(tokens[i])) { return null; }
    if (tokens[i].indexOf('n') >= 0) { hasN = true; }
    if (/^-[ABC]$/.test(tokens[i])) { i++; }
    i++;
  }
  if (!hasN) { return null; }
  var rest = tokens.slice(i);
  if (rest.length !== 2) { return null; }
  return { kind: 'bashGrep', path: stripPathQuotes(rest[1]) };
}

// First recognized partial-read shape for a command, or null.
function parseBashReadCommand(cmd) {
  if (typeof cmd !== 'string') { return null; }
  var trimmed = cmd.trim();
  return parseHead(trimmed) || parseSed(trimmed) || parseTail(trimmed) || parseWcOutput(trimmed) || parseGrep(trimmed);
}

module.exports = {
  parseBashReadCommand: parseBashReadCommand
};
