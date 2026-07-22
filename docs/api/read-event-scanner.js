// read-event-scanner: the ONE canonical scan of Read tool_use/tool_result pairs.
// Replaces the two legacy scanners that read the same records twice into
// incompatible shapes:
//   - extractReadEdits  (api/file-event-observations.js) — whole-content edits
//   - extractReadEvents (api/split-read-assembly.js)      — per-chunk geometry
// scanReadEvents(lines, parsed) returns a SUPERSET record per Read pair; two
// pure derivations reproduce each legacy shape exactly:
//   - chunkEventToEditRecord → the edit record (whole stripped content)
//   - chunkEventToReadEvent  → the chunk-geometry event
// The iteration spine (scanToolUseResults) and the record-shape builder
// (buildEditRecord) are reused from api/file-event-observations.js — single
// canonical home, no duplication. The strip/parse/validation helpers that were
// duplicated across the two legacy scanners are consolidated here.

var scanToolUseResults, buildEditRecord, stripCatLineNumbers;
if (typeof module !== 'undefined' && typeof require === 'function') {
    var fileObs = require('./file-event-observations');
    scanToolUseResults = fileObs.scanToolUseResults;
    buildEditRecord = fileObs.buildEditRecord;
    stripCatLineNumbers = fileObs.stripCatLineNumbers;
}

// Read results number every content line "N\tcontent". Lines without the tab
// prefix (system reminders, truncation notices) are not file content. This is
// tab-ONLY by design — the box-format "│" numbering is handled by the broader
// stripCatLineNumbers, not by the numbered-geometry parse.
var NUMBERED_LINE_PATTERN = /^(\d+)\t/;

// The text of a tool_result, whether recorded as a string or as text blocks.
// (Moved verbatim from split-read-assembly.js.)
function toolResultText(item) {
    if (typeof item.content === 'string') { return item.content; }
    if (!Array.isArray(item.content)) { return ''; }
    var texts = item.content.filter(function (c) { return c.type === 'text'; });
    return texts.map(function (c) { return c.text; }).join('\n');
}

// Split a Read result into {firstLineNumber, contentLines}: each tab-numbered
// line contributes its content (prefix stripped); unnumbered lines are skipped.
// Returns null when no tab-numbered line exists (errors, empty files, box-only).
// (Moved verbatim from split-read-assembly.js.)
function parseNumberedContent(resultText) {
    var rawLines = resultText.split('\n');
    var firstLineNumber = null;
    var contentLines = [];
    for (var i = 0; i < rawLines.length; i++) {
        var match = NUMBERED_LINE_PATTERN.exec(rawLines[i]);
        if (!match) { continue; }
        if (firstLineNumber === null) { firstLineNumber = parseInt(match[1], 10); }
        contentLines.push(rawLines[i].slice(match[0].length));
    }
    if (firstLineNumber === null) { return null; }
    return { firstLineNumber: firstLineNumber, contentLines: contentLines };
}

// True when Read content looks like a valid file (not an error message).
// (Moved verbatim from file-event-observations.js.)
function isValidReadContent(fileContent) {
    if (!fileContent) { return false; }
    if (fileContent.indexOf('Wasted call') === 0) { return false; }
    if (fileContent.indexOf('Error') === 0) { return false; }
    if (fileContent.indexOf('File does not exist') === 0) { return false; }
    return true;
}

// The legacy edit scanner captured STRING content only and gated on
// isValidReadContent of that RAW string (before stripping). Replicate exactly:
// a non-string tool_result content (array of blocks) is never a captured edit.
function isValidStringRead(item) {
    if (typeof item.content !== 'string') { return false; }
    return isValidReadContent(item.content);
}

// ─── The canonical scan ──────────────────────────────────────────────────────

// Read tool_use pending-entry builder: carries the file path and requested
// limit forward to the matching tool_result.
function buildReadScanPending(item, lineIndex) {
    if (!item.input) { return null; }
    var filePath = item.input.file_path || '';
    if (!filePath) { return null; }
    return { filePath: filePath, requestedLimit: item.input.limit || null };
}

// Read tool_result handler: build the superset record. ALWAYS returns a record
// (even for invalid/unnumbered reads) — the derivations apply each legacy
// scanner's drop rule, so the superset captures the union of both.
//   strippedContent — box + tab stripped (the edit scanner's content)
//   firstLineNumber / contentLines — tab-only geometry (the chunk scanner's)
//   isValidRead — the edit scanner's string+validity gate
function confirmReadScan(item, record, pending, lineIndex) {
    var rawResultText = toolResultText(item);
    var numbered = parseNumberedContent(rawResultText);
    return {
        filePath: pending.filePath,
        line: lineIndex,
        requestedLimit: pending.requestedLimit,
        timestamp: record.timestamp || null,
        rawResultText: rawResultText,
        strippedContent: stripCatLineNumbers(rawResultText),
        firstLineNumber: numbered === null ? null : numbered.firstLineNumber,
        contentLines: numbered === null ? [] : numbered.contentLines,
        isValidRead: isValidStringRead(item)
    };
}

// Every Read tool_use/tool_result pair in transcript order, as superset records.
// `lines` is unused (the legacy edit scanner's contract carried it too); the
// scan operates on `parsed` via the shared tool_use/tool_result spine.
function scanReadEvents(lines, parsed) {
    return scanToolUseResults(parsed, 'Read', buildReadScanPending, confirmReadScan);
}

// ─── Derivations (one superset record → each legacy shape) ───────────────────

// The edit-scanner shape: the WHOLE stripped content as an 'update' observation.
// null when the legacy scanner would have dropped it (invalid / non-string).
function chunkEventToEditRecord(record) {
    if (!record.isValidRead) { return null; }
    return buildEditRecord(record.line, record.filePath, record.strippedContent, 'read');
}

// The chunk-scanner shape: numbered geometry. null when no tab-numbered line
// existed (the legacy chunk scanner emitted nothing in that case).
function chunkEventToReadEvent(record) {
    if (record.firstLineNumber === null) { return null; }
    return {
        filePath: record.filePath,
        firstLineNumber: record.firstLineNumber,
        contentLines: record.contentLines,
        requestedLimit: record.requestedLimit,
        timestamp: record.timestamp,
        jsonlLine: record.line + 1
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        scanReadEvents: scanReadEvents,
        chunkEventToEditRecord: chunkEventToEditRecord,
        chunkEventToReadEvent: chunkEventToReadEvent,
        parseNumberedContent: parseNumberedContent,
        toolResultText: toolResultText,
        isValidReadContent: isValidReadContent
    };
}
