// script-run-detection: the PURE detection half of script-execution modeling — find a
// recorded script RUN (Bash OR context-mode MCP sandbox: ctx_execute / ctx_batch_execute)
// in a transcript, with no recovery or derivation (no IO). Split from
// script-execution-events so the foundational transcript-discovery can detect runs for
// the discovery bridge without pulling in the recovery/edit chain. A mere read/edit of
// the script is NOT a run (the execution guard requires an interpreter token).

var transforms = require('./script-transforms');

// Interpreter tokens that mark a command as RUNNING a script (vs cat/grep/Read of it).
var INTERPRETER_RE = /\b(?:python[0-9.]*|node|sh|bash|ruby|perl)\b/;
// A script-path token within the command (first \S+ ending in a script extension).
var SCRIPT_PATH_RE = /(\S+\.(?:py|js|sh|rb|pl))\b/;
// The `cd <dir> &&` prefix target = the run's working directory (script repo root).
var CD_TARGET_RE = /\bcd\s+('[^']*'|"[^"]*"|[^\s&|;]+)/;

// Strip a matched pair of surrounding single/double quotes.
function stripQuotes(s) {
    if (!s) { return s; }
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
        return s.slice(1, -1);
    }
    return s;
}

// The cwd a command runs in, taken from its leading `cd <dir> &&`, or null.
function extractCdTarget(command) {
    var m = command.match(CD_TARGET_RE);
    return m ? stripQuotes(m[1]) : null;
}

// Recognize an EXECUTED, modeled script run in one command string. Returns
// { type, scriptPath, cwd } or null.
function detectScriptInvocation(command) {
    if (typeof command !== 'string') { return null; }
    var type = transforms.recognizeScript(command);
    if (!type) { return null; }
    if (!INTERPRETER_RE.test(command)) { return null; }
    var pathMatch = command.match(SCRIPT_PATH_RE);
    return {
        type: type,
        scriptPath: pathMatch ? stripQuotes(pathMatch[1]) : null,
        cwd: extractCdTarget(command)
    };
}

// Command strings carried by input.commands[] (ctx_batch_execute), or [].
function batchCommands(input) {
    var cmds = [];
    if (!Array.isArray(input.commands)) { return cmds; }
    for (var i = 0; i < input.commands.length; i++) {
        var c = input.commands[i];
        if (c && typeof c.command === 'string') { cmds.push(c.command); }
    }
    return cmds;
}

// Every command string an execution-shaped tool_use carries: Bash (input.command),
// MCP ctx_execute (input.code / input.command), ctx_batch_execute (input.commands[].command).
function commandsFromToolUse(item) {
    if (!item || item.type !== 'tool_use' || !item.input) { return []; }
    var input = item.input;
    var cmds = [];
    if (typeof input.command === 'string') { cmds.push(input.command); }
    if (typeof input.code === 'string') { cmds.push(input.code); }
    Array.prototype.push.apply(cmds, batchCommands(input));
    return cmds;
}

// The tool_use/content items of a parsed record, or [].
function contentItems(record) {
    if (!record || !record.message || !Array.isArray(record.message.content)) { return []; }
    return record.message.content;
}

// A run descriptor for one command string (annotated with coordinates), or [].
function runsFromCommand(command, iso, jsonlLine) {
    var run = detectScriptInvocation(command);
    if (!run) { return []; }
    run.command = command;
    run.tExecIso = iso;
    run.jsonlLine = jsonlLine;
    return [run];
}

// Run descriptors from one content item (across all its command strings).
function runsFromItem(item, iso, jsonlLine) {
    var cmds = commandsFromToolUse(item);
    var runs = [];
    for (var k = 0; k < cmds.length; k++) {
        Array.prototype.push.apply(runs, runsFromCommand(cmds[k], iso, jsonlLine));
    }
    return runs;
}

// Run descriptors from one record. A record without a timestamp is skipped — it
// can't join the time-keyed timeline (same guard the content extractors use).
function runsFromRecord(record, jsonlLine) {
    if (!record || !record.timestamp) { return []; }
    var items = contentItems(record);
    var runs = [];
    for (var j = 0; j < items.length; j++) {
        Array.prototype.push.apply(runs, runsFromItem(items[j], record.timestamp, jsonlLine));
    }
    return runs;
}

// Detect every recorded script run in one transcript. One descriptor per run:
// { type, scriptPath, cwd, command, tExecIso, jsonlLine }.
function detectScriptRuns(parsed) {
    var runs = [];
    for (var i = 0; i < parsed.length; i++) {
        Array.prototype.push.apply(runs, runsFromRecord(parsed[i], i + 1));
    }
    return runs;
}

// True when an alias path lives under the run's repo root (cwd) — the run's scope.
function isUnderRepoRoot(aliasPath, cwd) {
    if (!cwd) { return false; }
    return aliasPath.indexOf(cwd.replace(/\/+$/, '') + '/') === 0;
}

// The repo-relative path of an alias under the run's repo root (cwd).
function repoRelOf(aliasPath, cwd) {
    var root = cwd.replace(/\/+$/, '') + '/';
    return aliasPath.indexOf(root) === 0 ? aliasPath.slice(root.length) : aliasPath;
}

module.exports = {
    detectScriptInvocation: detectScriptInvocation,
    detectScriptRuns: detectScriptRuns,
    isUnderRepoRoot: isUnderRepoRoot,
    repoRelOf: repoRelOf
};
