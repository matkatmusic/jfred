// grep-tool-evidence: materializer for the native-Grep grepMatches kind. The event stores
// the ONE file it belongs to (filePath) plus the session cwd; the result record carries
// rows for MANY files, so materialize re-parses the content and keeps only the rows whose
// relative path resolves (against cwd) back to this event's filePath. byLine carries the
// grep-reported ABSOLUTE line numbers; each ref is a byte-span into the tool_result's
// content property. Reuses line-state-evidence's ref pairing via a CALL-time requireLineStateEvidence() getter
// (both modules reassign module.exports — a load-time require captures a stale {}).

var loadParsedRecord = require('./evidence-record-access').loadParsedRecord;
var findToolResultText = require('./evidence-record-access').findToolResultText;
var resolveAgainstCwd = require('./file-historical-lineage').resolveAgainstCwd;
var parseGrepRows = require('./grep-tool-results').parseGrepRows;

function requireLineStateEvidence() { return require('./line-state-evidence'); }

// True when a parsed grep row belongs to this event's file: its relative path resolves
// (against the event's cwd) to the event's filePath.
function isGrepRowForFile(row, cwd, filePath) {
  return resolveAgainstCwd(cwd, row.relPath) === filePath;
}

// byLine {lineNum, text, ref} for this event's file, re-selected from the multi-file
// result. Spans are computed over the full content string, so filtering rows leaves the
// surviving entries' spans valid.
function materializeGrepMatchEvidence(event) {
  var result = findToolResultText(loadParsedRecord(event.jsonl, event.jsonlLine));
  var rows = parseGrepRows(result.text).filter(function (row) {
    return isGrepRowForFile(row, event.grepMatches.cwd, event.grepMatches.filePath);
  });
  return { kind: 'grepMatches', byLine: requireLineStateEvidence().pairEntriesWithReferences(event, result.property, rows) };
}

module.exports = {
  materializeGrepMatchEvidence: materializeGrepMatchEvidence
};
