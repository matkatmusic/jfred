// file-events-record-utils: small JSONL-record parsing helpers shared by the per-file
// event extractor. Split out of file-events-extractors.js so that module stays under
// the line cap; behavior is unchanged (verbatim moves).

// Parse one JSONL line, or null when it isn't valid JSON.
function tryParseJson(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
}

// Parse non-empty JSONL lines once; parsed[i] pairs with jsonlLine i+1.
function parseRecords(lines) {
    var parsed = [];
    for (var i = 0; i < lines.length; i++) { parsed.push(tryParseJson(lines[i])); }
    return parsed;
}

// The first sessionId any record carries, or '' (subagent transcripts have
// no snapshots, so a missing sessionId only disables blob resolution).
function findSessionId(parsed) {
    for (var i = 0; i < parsed.length; i++) {
        if (!parsed[i]) { continue; }
        if (parsed[i].sessionId) { return parsed[i].sessionId; }
    }
    return '';
}

// ISO timestamp of the record at a parsed index, or null. An event whose
// record carries no timestamp cannot join a time-keyed timeline — excluded.
function getTimestampAtRecord(parsed, index) {
    var record = parsed[index];
    if (!record) { return null; }
    return record.timestamp ? record.timestamp : null;
}

module.exports = {
    tryParseJson: tryParseJson,
    parseRecords: parseRecords,
    findSessionId: findSessionId,
    getTimestampAtRecord: getTimestampAtRecord
};
