// split-read-assembly: stitch chunked Read events (offset/limit) from ONE
// transcript into a complete per-file copy. A subagent reading a large file
// in chunks leaves no single event holding the whole file; inserting each
// result line at its absolute line number and checking contiguity from line 1
// recovers a truthful full copy at the moment of the last chunk.
// Moved (Phase 4) from tools/assemble-split-reads.js; the thin CLI stays there.
// Item 17: the per-chunk Read SCAN was unified into api/read-event-scanner.js;
// extractReadEvents is now a thin adapter over the canonical scan (the duplicate
// scan helpers were removed → archive/read-scanner-legacy-bodies.js). Only the
// multi-chunk STITCHING (assembleSplitReads + helpers) lives here.

var scanReadEvents = require('./read-event-scanner').scanReadEvents;
var chunkEventToReadEvent = require('./read-event-scanner').chunkEventToReadEvent;

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (parseError) {
    return null;
  }
}

// Every Read tool_use/tool_result pair in the transcript, in order, with the
// chunk geometry today's pipeline throws away — derived from the canonical scan
// (chunkEventToReadEvent drops pairs with no tab-numbered line, exactly as the
// legacy scanner did).
function extractReadEvents(jsonlText) {
  var lines = jsonlText.split('\n').filter(Boolean);
  var parsed = lines.map(parseJsonLine);
  return scanReadEvents(lines, parsed).map(chunkEventToReadEvent).filter(Boolean);
}

// Missing ranges in the sorted line-number keys, including a missing head
// (the copy must start at line 1).
function computeGaps(sortedLineNumbers) {
  var gaps = [];
  if (sortedLineNumbers.length === 0) { return gaps; }
  if (sortedLineNumbers[0] > 1) { gaps.push({ from: 1, to: sortedLineNumbers[0] - 1 }); }
  for (var i = 1; i < sortedLineNumbers.length; i++) {
    var expected = sortedLineNumbers[i - 1] + 1;
    if (sortedLineNumbers[i] > expected) { gaps.push({ from: expected, to: sortedLineNumbers[i] - 1 }); }
  }
  return gaps;
}

// True when some event covering the final assembled line returned fewer lines
// than it asked for (or asked for everything) — i.e. the read hit EOF, so the
// copy is not silently truncated at the tail.
function findEofConfirmationLine(lastLine, fileEvents) {
  for (var i = 0; i < fileEvents.length; i++) {
    var e = fileEvents[i];
    if (e.firstLineNumber + e.contentLines.length - 1 !== lastLine) { continue; }
    if (e.requestedLimit === null) { return true; }
    if (e.contentLines.length < e.requestedLimit) { return true; }
  }
  return false;
}

// The split-read assembly algorithm: insert every event's lines into a dict
// at [firstLineNumber + index] (later reads overwrite earlier ones), then the
// copy is complete when the keys run contiguously from line 1.
function assembleOneFile(filePath, fileEvents) {
  var lineByNumber = {};
  for (var i = 0; i < fileEvents.length; i++) {
    var event = fileEvents[i];
    for (var l = 0; l < event.contentLines.length; l++) {
      lineByNumber[event.firstLineNumber + l] = event.contentLines[l];
    }
  }
  var numbers = Object.keys(lineByNumber).map(Number).sort(function (a, b) { return a - b; });
  var gaps = computeGaps(numbers);
  var complete = gaps.length === 0;
  var lastLine = numbers[numbers.length - 1];
  return {
    filePath: filePath,
    complete: complete,
    content: complete ? numbers.map(function (n) { return lineByNumber[n]; }).join('\n') : null,
    gaps: gaps,
    firstLine: numbers[0],
    lastLine: lastLine,
    assembledLineCount: numbers.length,
    readCount: fileEvents.length,
    eofConfirmed: findEofConfirmationLine(lastLine, fileEvents),
    timestamp: fileEvents[fileEvents.length - 1].timestamp
  };
}

// One assembly per file that has at least one Read event, in first-seen order.
function assembleSplitReads(events) {
  var eventsByFile = {};
  var fileOrder = [];
  for (var i = 0; i < events.length; i++) {
    if (!eventsByFile[events[i].filePath]) {
      eventsByFile[events[i].filePath] = [];
      fileOrder.push(events[i].filePath);
    }
    eventsByFile[events[i].filePath].push(events[i]);
  }
  return fileOrder.map(function (filePath) {
    return assembleOneFile(filePath, eventsByFile[filePath]);
  });
}

module.exports = {
  extractReadEvents: extractReadEvents,
  assembleSplitReads: assembleSplitReads
};
