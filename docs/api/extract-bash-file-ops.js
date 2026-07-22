// Detect file-mutating Bash commands in JSONL transcripts:
// cp, mv, git mv, rm, and shell redirects (>, >>).

// Strip matched single or double quotes from a path string.
function stripPathQuotes(s) {
  if (!s) { return ''; }
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

// Split a command's argument portion into src and dst, handling quoted paths.
function splitTwoArgs(argStr) {
  var trimmed = argStr.trim();
  if (!trimmed) { return null; }
  var match = trimmed.match(/^("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s+("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s*$/);
  if (!match) { return null; }
  return { src: stripPathQuotes(match[1]), dst: stripPathQuotes(match[2]) };
}

// Strip leading flags (e.g., -r, -f, -a) from an argument string.
function stripFlags(argStr) {
  return argStr.replace(/^(\s*-[a-zA-Z]+\s+)+/, '');
}

var CP_PATTERN = /^cp\s+(.+)$/;
var MV_PATTERN = /^mv\s+(.+)$/;
var GIT_MV_PATTERN = /^git\s+mv\s+(.+)$/;
var RM_PATTERN = /^rm\s+(.+)$/;
var REDIRECT_PATTERN = /(>{1,2})\s*(\S+)\s*$/;

// Parse a cp command. Returns {type, src, dst} or null.
function parseBashCpCommand(cmd) {
  var m = CP_PATTERN.exec(cmd);
  if (!m) { return null; }
  var args = splitTwoArgs(stripFlags(m[1]));
  if (!args) { return null; }
  return { type: 'cp', src: args.src, dst: args.dst };
}

// Parse a mv command. Returns {type, src, dst} or null.
function parseBashMvCommand(cmd) {
  var m = MV_PATTERN.exec(cmd);
  if (!m) { return null; }
  var args = splitTwoArgs(stripFlags(m[1]));
  if (!args) { return null; }
  return { type: 'mv', src: args.src, dst: args.dst };
}

// Parse a git mv command. Returns {type, src, dst} or null.
function parseBashGitMvCommand(cmd) {
  var m = GIT_MV_PATTERN.exec(cmd);
  if (!m) { return null; }
  var args = splitTwoArgs(stripFlags(m[1]));
  if (!args) { return null; }
  return { type: 'git-mv', src: args.src, dst: args.dst };
}

// Parse an rm command. Returns {type, paths: []} or null.
function parseBashRmCommand(cmd) {
  var m = RM_PATTERN.exec(cmd);
  if (!m) { return null; }
  var argStr = stripFlags(m[1]).trim();
  if (!argStr) { return null; }
  var paths = argStr.split(/\s+/).map(stripPathQuotes);
  return { type: 'rm', paths: paths };
}

// Parse a shell redirect command. Returns {type, path, mode} or null.
function parseBashRedirectCommand(cmd) {
  var m = REDIRECT_PATTERN.exec(cmd);
  if (!m) { return null; }
  return { type: 'redirect', path: stripPathQuotes(m[2]), mode: m[1] };
}

// Try all parsers on a command string. Returns first match or null.
function parseAnyBashFileOp(cmd) {
  return parseBashGitMvCommand(cmd) || parseBashCpCommand(cmd) ||
    parseBashMvCommand(cmd) || parseBashRmCommand(cmd) ||
    parseBashRedirectCommand(cmd);
}

// Extract the Bash command string from a tool_use content item.
function extractBashCommand(item) {
  if (!item || item.type !== 'tool_use' || item.name !== 'Bash') { return null; }
  if (!item.input) { return null; }
  return item.input.command || null;
}

// Get the content array from a parsed JSONL message object.
function getContentArray(obj) {
  if (!obj || !obj.message || !Array.isArray(obj.message.content)) { return []; }
  return obj.message.content;
}

// Scan parsed JSONL objects for Bash file operations.
function extractBashFileOps(parsed) {
  var results = [];
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    var items = getContentArray(parsed[i]);
    for (var j = 0; j < items.length; j++) {
      var cmd = extractBashCommand(items[j]);
      if (!cmd) { continue; }
      var op = parseAnyBashFileOp(cmd);
      if (op) { op.line = i; results.push(op); }
    }
  }
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    stripPathQuotes: stripPathQuotes,
    parseBashCpCommand: parseBashCpCommand,
    parseBashMvCommand: parseBashMvCommand,
    parseBashGitMvCommand: parseBashGitMvCommand,
    parseBashRmCommand: parseBashRmCommand,
    parseBashRedirectCommand: parseBashRedirectCommand,
    extractBashFileOps: extractBashFileOps
  };
}
