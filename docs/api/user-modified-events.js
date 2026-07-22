// user-modified-events: the contentless `userModified` diagnostic event kind.
// Claude Code stamps toolUseResult.userModified:true on an Edit/Write when an
// external actor (user in the IDE, a formatter, a hook) changed the file around
// the edit — a DIRECT signal that recorded belief may have diverged from disk.
// We surface it as a contentless event at the edit's instant (kind sub-object
// {} — there is nothing to materialize as line content). Mirrors
// extractOriginalFileEventsFromEdits (file-events-extractors) but gates on the FLAG for
// ALL edit kinds, not on type==='edit'. The tracker (apply-one-event) records
// one diagnostic conflict and conservatively un-proves EOF.

var createKindEvent = require('./file-event-kinds').createKindEvent;
var doesEditBelongToFile = require('./file-historical-lineage').doesEditBelongToFile;

// ISO timestamp of the record at a parsed index, or null. Per-emitter convention
// (each emitter carries its own; see bash-op-events / structured-patch-events):
// importing it from file-events-extractors would form a require cycle, and an
// event whose record has no timestamp cannot join the time-keyed timeline.
function timestampAt(parsed, index) {
    var record = parsed[index];
    if (!record) { return null; }
    return record.timestamp ? record.timestamp : null;
}

// One userModified observation from one extracted edit, or null. The flag marks
// an out-of-band change around this edit; surface it as a contentless event at
// the edit's instant. All edit kinds (edit/create/update), not edit-only.
function buildUserModifiedEvent(jsonlPath, parsed, edit, statusByLine, aliasSet, aliasPaths) {
    if (edit.userModified !== true) { return null; }
    if (!doesEditBelongToFile(edit, aliasSet, aliasPaths)) { return null; }
    if (statusByLine[edit.line + 1] === 'ignored') { return null; }
    var isoTimestamp = timestampAt(parsed, edit.line);
    if (!isoTimestamp) { return null; }
    var event = createKindEvent(jsonlPath, edit.line + 1, isoTimestamp, 'userModified', {});
    event.aliasPath = edit.filePath;
    return event;
}

// userModified events for the kept edits of this file that carry the flag.
function extractUserModifiedEventsFromEdits(jsonlPath, parsed, edits, statusByLine, aliasPaths) {
    var aliasSet = new Set(aliasPaths);
    var events = [];
    for (var i = 0; i < edits.length; i++) {
        var event = buildUserModifiedEvent(jsonlPath, parsed, edits[i], statusByLine, aliasSet, aliasPaths);
        if (event) { events.push(event); }
    }
    return events;
}

module.exports = {
    buildUserModifiedEvent: buildUserModifiedEvent,
    extractUserModifiedEventsFromEdits: extractUserModifiedEventsFromEdits
};
