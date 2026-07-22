// Which edits survived code-restoration rewinds — every reconstruction
// consumer depends on this verdict. Home of rewind detection/classification
// and the kept/ignored edit classification (analyzeJSONL).
// Loadable in Node (require) and the browser (script tag, where
// api/transcript-parsers.js must be loaded first).

if (typeof module !== 'undefined' && typeof require === 'function') {
  var transcriptParsers = require('./transcript-parsers');
  parseTranscriptRecords = transcriptParsers.parseTranscriptRecords;
  collectUserPrompts = transcriptParsers.collectUserPrompts;
}

// Find the last snapshot with .line strictly before lineIdx, or null.
function findLastSnapBefore(snapshots, lineIdx) {
  var result = null;
  for (var s = 0; s < snapshots.length; s++) {
    if (snapshots[s].line < lineIdx) {
      result = snapshots[s];
    } else {
      break;
    }
  }
  return result;
}

// Find the first snapshot with .line at or after lineIdx, or null.
function findFirstSnapAfter(snapshots, lineIdx) {
  for (var s = 0; s < snapshots.length; s++) {
    if (snapshots[s].line >= lineIdx) {
      return snapshots[s];
    }
  }
  return null;
}

// Check if any write in fileWrites has .line strictly between startLine and endLine.
function hasWriteBetween(fileWrites, startLine, endLine) {
  for (var w = 0; w < fileWrites.length; w++) {
    if (fileWrites[w].line > startLine && fileWrites[w].line < endLine) {
      return true;
    }
  }
  return false;
}

// Walk the parent chain from cur, collecting visited lines.
// Returns the first target line that is before threshold, or -1.
function walkParentChain(parsed, uuidToIdx, cur, threshold) {
  var visited = {};
  while (cur && cur.parentUuid) {
    var pLine = uuidToIdx[cur.parentUuid];
    if (pLine === undefined || visited[pLine]) {
      break;
    }
    visited[pLine] = true;
    if (pLine < threshold) {
      return pLine;
    }
    cur = parsed[pLine];
  }
  return -1;
}

// Walk the parent chain from lineIdx backward, looking for a link that
// jumps to a line significantly earlier in the file.
// Returns the target line index or -1 if no backward jump found.
function findBackwardJump(parsed, uuidToIdx, lineIdx) {
  return walkParentChain(parsed, uuidToIdx, parsed[lineIdx], lineIdx - 3);
}

// Check prev-to-before window for code-restoration signal.
function checkPrevWindow(snapPrev, snapBefore, fileWrites) {
  if (snapPrev && snapBefore) {
    var changed = JSON.stringify(snapPrev.files) !== JSON.stringify(snapBefore.files);
    if (changed && !hasWriteBetween(fileWrites, snapPrev.line, snapBefore.line)) {
      return true;
    }
  }
  return false;
}

// Check before-to-after window for code-restoration signal.
function checkBeforeAfterWindow(snapBefore, snapAfter, fileWrites) {
  if (snapBefore && snapAfter && snapBefore.line !== snapAfter.line) {
    var changed = JSON.stringify(snapBefore.files) !== JSON.stringify(snapAfter.files);
    if (changed && !hasWriteBetween(fileWrites, snapBefore.line, snapAfter.line)) {
      return true;
    }
  }
  return false;
}

// Check if any file in snapBefore has version > 1 with null backup.
function checkBackupVersions(snapBefore) {
  if (!snapBefore) {
    return false;
  }
  var fnames = Object.keys(snapBefore.files);
  for (var fi = 0; fi < fnames.length; fi++) {
    var fv = snapBefore.files[fnames[fi]];
    if (fv.version > 1 && fv.backup === null) {
      return true;
    }
  }
  return false;
}

// Run the 3-window heuristic to classify a rewind.
function classifyByWindows(snapPrev, snapBefore, snapAfter, fileWrites) {
  if (checkPrevWindow(snapPrev, snapBefore, fileWrites)) {
    return 'code-restoration';
  }
  if (checkBeforeAfterWindow(snapBefore, snapAfter, fileWrites)) {
    return 'code-restoration';
  }
  if (checkBackupVersions(snapBefore)) {
    return 'code-restoration';
  }
  return 'conversation-only';
}

// Classify a rewind landing as code-restoration or conversation-only using 3-window heuristic.
function classifyRewindType(snapshots, fileWrites, landingLine) {
  var snapBefore = findLastSnapBefore(snapshots, landingLine);
  var snapAfter = findFirstSnapAfter(snapshots, landingLine);
  var snapPrev = snapBefore ? findLastSnapBefore(snapshots, snapBefore.line) : null;
  var classification = classifyByWindows(snapPrev, snapBefore, snapAfter, fileWrites);
  return { classification: classification, snapBefore: snapBefore, snapAfter: snapAfter };
}

// Check sibling signal: parentUuid seen before.
// Mutates p.parentLine if needed. Returns true if sibling detected.
function checkSiblingSignal(p, seenParents, uuidToIdx) {
  if (p.parentUuid && seenParents[p.parentUuid] !== undefined) {
    if (p.parentLine < 0) {
      p.parentLine = uuidToIdx[p.parentUuid] || 0;
    }
    return true;
  }
  return false;
}

// Check the 3 rewind signals: backward jump, indirect jump, sibling detection.
// Returns true if prompt p is a rewind, and mutates p.parentLine if needed.
function checkRewindSignals(p, highWater, seenParents, parsed, uuidToIdx) {
  if (p.parentLine >= 0 && p.parentLine < highWater - 3) {
    return true;
  }
  var bjt = findBackwardJump(parsed, uuidToIdx, p.line);
  if (bjt >= 0 && bjt < highWater - 3) {
    p.parentLine = bjt;
    return true;
  }
  return checkSiblingSignal(p, seenParents, uuidToIdx);
}

// Build a rewind record from a prompt and classification result.
function buildRewindEntry(p, classResult) {
  return {
    landingLine: p.line,
    parentLine: p.parentLine,
    text: p.text || '',
    classification: classResult.classification,
    snapBefore: classResult.snapBefore,
    snapAfter: classResult.snapAfter
  };
}

// Update tracking state (seenParents, highWater) after processing a prompt.
// Returns the new highWater value.
function updateRewindTracking(p, seenParents, highWater) {
  if (p.parentUuid && seenParents[p.parentUuid] === undefined) {
    seenParents[p.parentUuid] = p.line;
  }
  return p.line > highWater ? p.line : highWater;
}

// Detect rewinds using 3 signals: backward jump, indirect jump, sibling detection.
// Returns 0-based line numbers.
function detectRewinds(prompts, parsed, uuidToIdx, snapshots, fileWrites) {
  var rewinds = [];
  var highWater = 0;
  var seenParents = {};
  for (var u = 0; u < prompts.length; u++) {
    var p = prompts[u];
    if (checkRewindSignals(p, highWater, seenParents, parsed, uuidToIdx)) {
      var r = classifyRewindType(snapshots, fileWrites, p.line);
      rewinds.push(buildRewindEntry(p, r));
    }
    highWater = updateRewindTracking(p, seenParents, highWater);
  }
  return rewinds;
}

// Check if a file write is ignored by any code-restoration rewind.
// A rewind ignores the write when it lands after the write but its parent
// (the point rewound to) is before the write.
function isIgnoredByRewind(fwLine, rewinds) {
  for (var r = 0; r < rewinds.length; r++) {
    if (doRewindReverts(rewinds[r], fwLine)) {
      return true;
    }
  }
  return false;
}

// Check whether one rewind reverts the file past a write at fwLine.
function doRewindReverts(rewind, fwLine) {
  if (rewind.landingLine <= fwLine) {
    return false;
  }
  if (rewind.classification !== 'code-restoration') {
    return false;
  }
  if (rewind.parentLine >= fwLine) {
    return false;
  }
  return true;
}

// Mark each file write as kept or ignored based on code-restoration rewinds.
function classifyFileWrites(fileWrites, rewinds) {
  var results = [];
  for (var w = 0; w < fileWrites.length; w++) {
    var fw = fileWrites[w];
    var ignored = isIgnoredByRewind(fw.line, rewinds);
    results.push({
      line: fw.line + 1,
      status: ignored ? 'ignored' : 'kept',
      type: fw.type,
      file: fw.file
    });
  }
  return results;
}

// Orchestrate parsing, rewind detection, and edit classification.
function analyzeJSONL(text) {
  var p = parseTranscriptRecords(text);
  var prompts = collectUserPrompts(p.parsed, p.uuidToIdx);
  var rewinds = detectRewinds(prompts, p.parsed, p.uuidToIdx, p.snapshots, p.fileWrites);
  var edits = classifyFileWrites(p.fileWrites, rewinds);
  return { edits: edits, rewinds: rewinds, fileWrites: p.fileWrites };
}

// Returns a string with one line per file-modifying event.
function classifyEdits(jsonlText) {
  var result = analyzeJSONL(jsonlText);
  var lines = [];
  for (var i = 0; i < result.edits.length; i++) {
    var e = result.edits[i];
    lines.push(e.line + ': ' + e.status + ' ' + e.type + ' ' + e.file);
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findLastSnapBefore: findLastSnapBefore,
    findFirstSnapAfter: findFirstSnapAfter,
    hasWriteBetween: hasWriteBetween,
    findBackwardJump: findBackwardJump,
    classifyRewindType: classifyRewindType,
    detectRewinds: detectRewinds,
    analyzeJSONL: analyzeJSONL,
    classifyEdits: classifyEdits
  };
}
