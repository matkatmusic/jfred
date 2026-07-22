// script-transforms: the seam for modeling a recorded script run as a transform.
// Recognize a script invocation from its command string, declare the data input it
// needs, and derive a transform spec from that input. One type today:
// 'rename-functions' — whole-token renames from function-names-enriched.csv, a
// faithful model of plans/naming/rename-functions.py. Adding a script type = a new
// branch in recognizeScript/requiredDataInput/deriveTransform plus its deriver.

// The recorded script type for a command string, or null. Matches whether the run
// was a Bash tool_use or an MCP ctx_execute/ctx_batch_execute (both carry the
// command text). Add recognizers here as new script types are modeled.
function recognizeScript(command) {
    if (typeof command !== 'string') { return null; }
    if (command.indexOf('rename-functions.py') !== -1) { return 'rename-functions'; }
    return null;
}

// The repo-relative data-input file a transform type derives from.
function requiredDataInput(type) {
    if (type === 'rename-functions') { return 'plans/naming/function-names-enriched.csv'; }
    throw new Error('unknown transform type: ' + type);
}

// Header-name -> column-index map for a CSV header row.
function indexColumns(header) {
    var idx = {};
    for (var i = 0; i < header.length; i++) { idx[header[i].trim()] = i; }
    return idx;
}

// One sub from one enriched-CSV data row, or null for a no-op (old==new) row.
// GLOBAL (isExported==='Y') subs apply to every in-scope file (file:null); LOCAL
// subs target a single repo-relative file. expectedCount mirrors numReferences.
function parseRow(cols, idx) {
    var oldName = cols[idx.oldName];
    var newName = cols[idx.newName];
    if (!oldName || oldName === newName) { return null; }
    var isExported = cols[idx.isExported] === 'Y';
    return {
        old: oldName,
        new: newName,
        scope: isExported ? 'global' : 'local',
        file: isExported ? null : cols[idx.file].replace(/^\.\//, ''),
        expectedCount: parseInt(cols[idx.numReferences], 10)
    };
}

// The whole-token rename spec derived from the enriched CSV content.
function deriveRenameTransform(csv) {
    var lines = csv.split('\n').filter(Boolean);
    var idx = indexColumns(lines[0].split(','));
    var subs = [];
    for (var i = 1; i < lines.length; i++) {
        var sub = parseRow(lines[i].split(','), idx);
        if (sub) { subs.push(sub); }
    }
    return { type: 'wholeTokenRename', subs: subs };
}

// Dispatch to the deriver for a recognized script type. inputs carries the recovered
// data-input content (e.g. { csv } for rename-functions).
function deriveTransform(type, inputs) {
    if (type === 'rename-functions') { return deriveRenameTransform(inputs.csv); }
    throw new Error('unknown transform type: ' + type);
}

// The subs that apply to one repo-relative file: every global sub plus the local
// subs that target this file, in CSV order.
function subsForFile(subs, repoRelPath) {
    var out = [];
    for (var i = 0; i < subs.length; i++) {
        var s = subs[i];
        if (s.scope === 'global' || s.file === repoRelPath) { out.push(s); }
    }
    return out;
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-token (\bold\b) replacement with a replacement count — the JS mirror of the
// python replace_whole_token. A function replacement avoids $-sequence interpretation.
function applyWholeToken(content, oldName, newName) {
    var re = new RegExp('\\b' + escapeRegExp(oldName) + '\\b', 'g');
    var count = 0;
    var out = content.replace(re, function () { count++; return newName; });
    return { content: out, count: count };
}

module.exports = {
    recognizeScript: recognizeScript,
    requiredDataInput: requiredDataInput,
    deriveTransform: deriveTransform,
    deriveRenameTransform: deriveRenameTransform,
    subsForFile: subsForFile,
    applyWholeToken: applyWholeToken
};
