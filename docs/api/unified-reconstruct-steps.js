// Unified reconstruction: step extraction orchestration over JSONL transcripts.
// The per-source-type extractors and matching primitives live in the sibling
// module unified-reconstruct-step-extractors.js (split out to stay under the
// file-size cap); this module walks each transcript and assembles ordered steps.
// The public export surface is unchanged — extractor functions are re-exported.

var ext, extractBashFileOps, extractSessionMetadata;
var buildStep, parseUnifiedJsonlLines, extractSessionId, getSnapshotContentForFile;
var getMessageContentArray, buildEditStep;
var checkReadToolUse, checkReadToolResult, checkCatToolUse, checkCatToolResult;
if (typeof module !== 'undefined' && typeof require === 'function') {
  ext = require('./unified-reconstruct-step-extractors');
  buildStep = ext.buildStep;
  parseUnifiedJsonlLines = ext.parseUnifiedJsonlLines;
  extractSessionId = ext.extractSessionId;
  getSnapshotContentForFile = ext.getSnapshotContentForFile;
  getMessageContentArray = ext.getMessageContentArray;
  buildEditStep = ext.buildEditStep;
  checkReadToolUse = ext.checkReadToolUse;
  checkReadToolResult = ext.checkReadToolResult;
  checkCatToolUse = ext.checkCatToolUse;
  checkCatToolResult = ext.checkCatToolResult;
  extractBashFileOps = require('./extract-bash-file-ops').extractBashFileOps;
  extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
}

// ─── Step extraction orchestration ────────────────────────────────────────────

function getSnapshotTimestamp(record) {
  return record.timestamp || (record.snapshot && record.snapshot.timestamp) || '';
}

function appendSnapshotSteps(parsed, targetFile, sourcePath, steps) {
  var sessionId = extractSessionId(parsed);
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    if (parsed[i].type !== 'file-history-snapshot') { continue; }
    var content = getSnapshotContentForFile(parsed[i].snapshot, targetFile, sessionId);
    if (content !== null) {
      steps.push(buildStep(i, getSnapshotTimestamp(parsed[i]), sourcePath, { snapshot: content }));
    }
  }
}

function appendEditSteps(parsed, targetFile, sourcePath, steps) {
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    if (!parsed[i].toolUseResult) { continue; }
    var ts = parsed[i].timestamp || '';
    var step = buildEditStep(parsed[i].toolUseResult, i, ts, targetFile, sourcePath);
    if (step) { steps.push(step); }
  }
}

function appendReadSteps(parsed, targetFile, sourcePath, steps) {
  var pending = {};
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    var content = getMessageContentArray(parsed[i]);
    if (!content) { continue; }
    var ts = parsed[i].timestamp || '';
    for (var c = 0; c < content.length; c++) {
      checkReadToolUse(content[c], i, targetFile, pending);
      checkReadToolResult(content[c], parsed[i], i, ts, sourcePath, pending, steps);
    }
  }
}

function appendCatSteps(parsed, targetFile, cwd, sourcePath, steps) {
  var pending = {};
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    var content = getMessageContentArray(parsed[i]);
    if (!content) { continue; }
    var ts = parsed[i].timestamp || '';
    for (var c = 0; c < content.length; c++) {
      checkCatToolUse(content[c], i, targetFile, cwd, pending);
      checkCatToolResult(content[c], parsed[i], i, ts, sourcePath, pending, steps);
    }
  }
}

// Append steps for Bash file operations (cp, mv, git mv, rm, redirect).
function appendBashFileOpSteps(parsed, sourcePath, steps) {
  if (!extractBashFileOps) { return; }
  var ops = extractBashFileOps(parsed);
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    var ts = (parsed[op.line] && parsed[op.line].timestamp) || '';
    steps.push(buildStep(op.line, ts, sourcePath, { bashFileOp: op }));
  }
}

function extractStepsFromSingleJSONL(jsonlText, targetFile, sourcePath) {
  var lines = jsonlText.split('\n').filter(Boolean);
  var parsed = parseUnifiedJsonlLines(lines);
  var cwd = extractSessionMetadata ? extractSessionMetadata(jsonlText).cwd : null;
  var steps = [];
  appendSnapshotSteps(parsed, targetFile, sourcePath, steps);
  appendEditSteps(parsed, targetFile, sourcePath, steps);
  appendReadSteps(parsed, targetFile, sourcePath, steps);
  appendCatSteps(parsed, targetFile, cwd, sourcePath, steps);
  appendBashFileOpSteps(parsed, sourcePath, steps);
  steps.sort(function(a, b) { return a.line - b.line; });
  return steps;
}

function extractStepsFromJSONLs(jsonlTexts, targetFile) {
  var allSteps = [];
  for (var j = 0; j < jsonlTexts.length; j++) {
    var steps = extractStepsFromSingleJSONL(jsonlTexts[j].text, targetFile, jsonlTexts[j].path);
    for (var s = 0; s < steps.length; s++) { allSteps.push(steps[s]); }
  }
  allSteps.sort(function(a, b) {
    if (a.timestamp !== b.timestamp) { return a.timestamp < b.timestamp ? -1 : 1; }
    return a.line - b.line;
  });
  return allSteps;
}

// Re-export the extractor surface so the public API is unchanged after the split.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildStep: ext.buildStep,
    tryParseUnified: ext.tryParseUnified,
    doesMatchTargetFile: ext.doesMatchTargetFile,
    getMessageContentArray: ext.getMessageContentArray,
    isValidReadOutput: ext.isValidReadOutput,
    getSnapshotContentForFile: ext.getSnapshotContentForFile,
    buildEditObject: ext.buildEditObject,
    buildEditStep: ext.buildEditStep,
    extractStepsFromSingleJSONL: extractStepsFromSingleJSONL,
    extractStepsFromJSONLs: extractStepsFromJSONLs
  };
}
