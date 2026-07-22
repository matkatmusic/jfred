// evidence-record-access: record-loading + locator helpers for the per-line
// state tracker's evidence layer. Loads the parsed JSONL record behind an
// event (cached per transcript) and locates a result line's text — either as
// the tool_result text (with the record property naming it) or as a
// structuredPatch hunk/index. Extracted from line-state-evidence (roadmap item
// 1) so that file lands under the 250-line cap; the materialization helpers
// import these directly (one canonical home, no re-export from the old module).

var fs = require('fs');

// ─── Record loading (cached per transcript) ─────────────────────────────────

var transcriptLinesCache = new Map();

// The parsed record at a 1-based non-empty-line index of a transcript.
function loadParsedRecord(jsonlPath, jsonlLine) {
  if (!transcriptLinesCache.has(jsonlPath)) {
    var text = fs.readFileSync(jsonlPath, 'utf8');
    transcriptLinesCache.set(jsonlPath, text.split('\n').filter(Boolean));
  }
  var line = transcriptLinesCache.get(jsonlPath)[jsonlLine - 1];
  if (line === undefined) { return null; }
  try { return JSON.parse(line); } catch (e) { return null; }
}

// {property, text} from a tool_result whose content is a text-block array.
function findFirstTextBlockInToolResult(item, itemIndex) {
  for (var t = 0; t < item.content.length; t++) {
    if (item.content[t].type === 'text') {
      return { property: 'message.content[' + itemIndex + '].content[' + t + '].text', text: item.content[t].text };
    }
  }
  return null;
}

// {property, text} of one tool_result item, by its content's shape.
function extractToolResultTextWithProperty(item, itemIndex) {
  if (typeof item.content === 'string') {
    return { property: 'message.content[' + itemIndex + '].content', text: item.content };
  }
  if (Array.isArray(item.content)) { return findFirstTextBlockInToolResult(item, itemIndex); }
  return null;
}

// {property, text} of the first tool_result in a record, or null.
function findToolResultText(record) {
  if (!record) { return null; }
  if (!record.message) { return null; }
  var content = record.message.content;
  if (!Array.isArray(content)) { return null; }
  for (var c = 0; c < content.length; c++) {
    if (content[c].type !== 'tool_result') { continue; }
    var found = extractToolResultTextWithProperty(content[c], c);
    if (found) { return found; }
  }
  return null;
}

// {hunkIndex, lineIndex} of lineText inside one hunk's lines ('+' added or
// ' ' context only — '-' lines are not result content), or null.
function findLineInHunk(hunk, hunkIndex, lineText) {
  var lines = Array.isArray(hunk.lines) ? hunk.lines : [];
  for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (lines[lineIndex].charAt(0) === '-') { continue; }
    if (lines[lineIndex].slice(1) === lineText) { return { hunkIndex: hunkIndex, lineIndex: lineIndex }; }
  }
  return null;
}

// {hunkIndex, lineIndex} of a result line in toolUseResult.structuredPatch.
function findStructuredPatchLine(record, lineText) {
  if (!record) { return null; }
  if (!record.toolUseResult) { return null; }
  var hunks = record.toolUseResult.structuredPatch;
  if (!Array.isArray(hunks)) { return null; }
  for (var hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
    var found = findLineInHunk(hunks[hunkIndex], hunkIndex, lineText);
    if (found) { return found; }
  }
  return null;
}

module.exports = {
  loadParsedRecord: loadParsedRecord,
  findToolResultText: findToolResultText,
  findStructuredPatchLine: findStructuredPatchLine
};
