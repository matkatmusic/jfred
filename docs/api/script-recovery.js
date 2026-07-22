// script-recovery: recover a recorded script's source and its declared data inputs
// (e.g. the rename CSV) AS OF T_exec. The algorithm's recovery step:
//   still exists on disk?  Yes -> read it (primary, verbatim).
//                          No  -> recreate from the JSONL: replay the file's own
//                                 create/edit records up to T_exec.
// The recreate path is time-bounded by each record's timestamp, so a script edited
// several times BEFORE its single run recovers to the pre-run version (later edits are
// excluded) — and a script whose on-disk copy is gone is still recoverable.

var fs = require('fs');
var path = require('path');
var ese = require('./edit-stream-extraction');
var replay = require('./edit-replay');
var st = require('./script-transforms');

// True only when the path exists AND is a regular file (never a directory).
function isExistingFile(p) {
    return fs.existsSync(p) && fs.statSync(p).isFile();
}

// Index-aligned parsed records (null for unparseable lines), matching the line
// indices extract-stream-extraction assigns to each edit (edit.line).
function parseRecords(jsonlText) {
    return jsonlText.split('\n').map(function (l) {
        try { return JSON.parse(l); } catch (e) { return null; }
    });
}

// The epoch-ms of the record an edit came from, or null when it has no timestamp.
function recordMsAt(records, index) {
    var rec = records[index];
    if (!rec || !rec.timestamp) { return null; }
    return Date.parse(rec.timestamp);
}

// An edit targets this file when its full path matches, or (fallback) its basename.
function editMatchesFile(edit, targetFilePath) {
    if (edit.filePath === targetFilePath) { return true; }
    return edit.file === path.basename(targetFilePath);
}

// Keep an edit only if it is at/under the time bound. A null bound keeps everything;
// a bounded edit with no timestamp is dropped (it can't be proven pre-run).
function isWithinBound(ms, asOfMs) {
    if (asOfMs === null || asOfMs === undefined) { return true; }
    return ms !== null && ms <= asOfMs;
}

// Recreate the target file's content from its create/edit records up to asOfMs.
function reconstructAsOf(jsonlText, targetFilePath, asOfMs) {
    var records = parseRecords(jsonlText);
    var edits = ese.extractEditsFromJSONL(jsonlText);
    var kept = [];
    for (var i = 0; i < edits.length; i++) {
        if (!editMatchesFile(edits[i], targetFilePath)) { continue; }
        if (!isWithinBound(recordMsAt(records, edits[i].line), asOfMs)) { continue; }
        kept.push(edits[i]);
    }
    return replay.replayEdits(kept);
}

// Recover one file's content as of asOfMs. { via: 'on-disk'|'reconstructed'|'none', content }.
function recoverFileAsOf(absPath, jsonlText, asOfMs) {
    if (isExistingFile(absPath)) {
        return { via: 'on-disk', content: fs.readFileSync(absPath, 'utf8') };
    }
    var content = reconstructAsOf(jsonlText || '', absPath, asOfMs);
    if (content) { return { via: 'reconstructed', content: content }; }
    return { via: 'none', content: null };
}

// Recover the script source AND its declared data input (e.g. the rename CSV) as of
// T_exec. opts: { cwd, scriptPath, scriptType, jsonlText, asOfMs }. cwd is the run's
// repo root; requiredDataInput maps scriptType -> the repo-relative data-input path.
function recoverScriptAndInput(opts) {
    var script = recoverFileAsOf(path.join(opts.cwd, opts.scriptPath), opts.jsonlText, opts.asOfMs);
    var dataInputRel = st.requiredDataInput(opts.scriptType);
    var dataInput = recoverFileAsOf(path.join(opts.cwd, dataInputRel), opts.jsonlText, opts.asOfMs);
    return { script: script, dataInput: dataInput, dataInputRelPath: dataInputRel };
}

module.exports = {
    recoverFileAsOf: recoverFileAsOf,
    reconstructAsOf: reconstructAsOf,
    recoverScriptAndInput: recoverScriptAndInput
};
