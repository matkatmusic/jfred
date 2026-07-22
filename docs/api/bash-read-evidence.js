// bash-read-evidence: materializers for the partial-content Bash-read kinds.
// The materializer sees ONLY the result record (the command and its geometry are
// gone), so bashReadChunk numbers its raw stdout lines from the firstLine that
// emission computed and stored on the sub-object — UNLIKE readChunk, whose
// stdout carries Read's "N\t" line-number prefixes. Reuses line-state-evidence's
// content-splitting + ref-pairing helpers via a CALL-time requireLineStateEvidence() getter (both
// modules reassign module.exports, so a load-time require captures a stale {} —
// mirrors structured-patch-evidence). loadParsedRecord/findToolResultText come
// from evidence-record-access (no cycle), so those are load-time imports.

var loadParsedRecord = require('./evidence-record-access').loadParsedRecord;
var findToolResultText = require('./evidence-record-access').findToolResultText;

function requireLineStateEvidence() { return require('./line-state-evidence'); }

// {lineNum, text, startIndex, endIndex} per raw stdout line, numbered from
// firstLine; the span is the byte range of the line within text (the property
// each ref points at).
function buildBashReadChunkLineEntries(text, firstLine) {
  var lines = requireLineStateEvidence().splitContentIntoLineSpans(text);
  var spans = requireLineStateEvidence().computeContentLineSpans(text);
  var entries = [];
  for (var i = 0; i < lines.length; i++) {
    entries.push({ lineNum: firstLine + i, text: lines[i], startIndex: spans[i].startIndex, endIndex: spans[i].endIndex });
  }
  return entries;
}

// byLine {lineNum, text, ref} for a head/sed/tail chunk, numbered from firstLine.
function materializeBashReadChunkEvidence(event) {
  var result = findToolResultText(loadParsedRecord(event.jsonl, event.jsonlLine));
  var entries = buildBashReadChunkLineEntries(result.text, event.bashReadChunk.firstLine);
  return { kind: 'bashReadChunk', byLine: requireLineStateEvidence().pairEntriesWithReferences(event, result.property, entries) };
}

// wc -l: the leading integer of stdout (e.g. "  207 file"). REF-LESS — it
// witnesses extent, not line content (same shape as fileAbsent); the event's own
// jsonl/jsonlLine is the provenance. A missing count degrades to 0 (apply is a
// no-op extend).
function materializeBashExtentEvidence(event) {
  var result = findToolResultText(loadParsedRecord(event.jsonl, event.jsonlLine));
  var match = /^\s*(\d+)/.exec(result.text);
  return { kind: 'bashExtent', lineCount: match ? parseInt(match[1], 10) : 0 };
}

// grep -n rows: "N:content" (match) and "N-content" (-A/-B/-C context). Each
// row's absolute line number is explicit, so entries are numbered from it (NOT a
// firstLine). The span excludes the "N:"/"N-" prefix. "--" group separators and
// any non-numbered row don't match and are skipped — modeled on buildNumberedEntries.
function grepEntries(text) {
  var rawLines = text.split('\n');
  var entries = [];
  var offset = 0;
  for (var i = 0; i < rawLines.length; i++) {
    var match = /^(\d+)[:-]/.exec(rawLines[i]);
    if (match) {
      entries.push({
        lineNum: parseInt(match[1], 10),
        text: rawLines[i].slice(match[0].length),
        startIndex: offset + match[0].length,
        endIndex: offset + rawLines[i].length
      });
    }
    offset += rawLines[i].length + 1;
  }
  return entries;
}

// byLine {lineNum, text, ref} for single-file grep -n output.
function materializeBashGrepEvidence(event) {
  var result = findToolResultText(loadParsedRecord(event.jsonl, event.jsonlLine));
  return { kind: 'bashGrep', byLine: requireLineStateEvidence().pairEntriesWithReferences(event, result.property, grepEntries(result.text)) };
}

module.exports = {
  materializeBashReadChunkEvidence: materializeBashReadChunkEvidence,
  materializeBashExtentEvidence: materializeBashExtentEvidence,
  materializeBashGrepEvidence: materializeBashGrepEvidence
};
