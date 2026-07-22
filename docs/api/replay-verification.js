// replay-verification: replay an edit stream and compare it against a reference
// (on-disk / file-history snapshot / git). The verification half of the engine,
// moved (Phase 5) from common/replay-edits.js. The private text→kept-array helper
// is renamed extractKeptEditsFromJsonlText (the exported path-based extractKeptEditsForFile
// is in api/edit-stream-extraction.js). No console/argv.
var fs = require('fs');
var path = require('path');
var extractEditsFromJSONL = require('./edit-stream-extraction').extractEditsFromJSONL;
var replayEdits = require('./edit-replay').replayEdits;
var analyzeJSONL = require('./rewind-classification').analyzeJSONL;
var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
var gitState = require('./git-file-state');
var findLastSnapshotContent = require('./reconstruction-reference-sources').findLastSnapshotContent;

// ─── Helpers for computeDiff ────────────────────────────────────────────────

// Build diff entries for a single line index, returning array of diff strings.
function buildDiffForLine(expLines, actLines, i) {
  var e = i < expLines.length ? expLines[i] : undefined;
  var a = i < actLines.length ? actLines[i] : undefined;
  var parts = [];
  if (e !== a) {
    if (e !== undefined) { parts.push('- L' + (i + 1) + ': ' + e); }
    if (a !== undefined) { parts.push('+ L' + (i + 1) + ': ' + a); }
  }
  return parts;
}

// Collect all diff parts across all line indices.
function collectDiffParts(expLines, actLines) {
  var diff = [];
  var max = Math.max(expLines.length, actLines.length);
  for (var i = 0; i < max; i++) {
    var parts = buildDiffForLine(expLines, actLines, i);
    for (var p = 0; p < parts.length; p++) { diff.push(parts[p]); }
  }
  return diff;
}

// Simple line diff between expected and actual strings.
function computeDiff(expected, actual) {
  return collectDiffParts(expected.split('\n'), actual.split('\n')).join('\n');
}

// ─── Helpers for filterKeptEdits ────────────────────────────────────────────

// Build a map of line number -> status from classified edits.
function buildStatusByLineMap(classifiedEdits) {
  var statusByLine = {};
  for (var c = 0; c < classifiedEdits.length; c++) {
    statusByLine[classifiedEdits[c].line] = classifiedEdits[c].status;
  }
  return statusByLine;
}

// Separate kept edits from ignored edits using classification results.
function filterKeptEdits(allEdits, classifiedEdits) {
  var statusByLine = buildStatusByLineMap(classifiedEdits);
  var keptEdits = [];
  var ignoredCount = 0;
  for (var i = 0; i < allEdits.length; i++) {
    if (statusByLine[allEdits[i].line + 1] === 'ignored') { ignoredCount++; }
    else { keptEdits.push(allEdits[i]); }
  }
  return { keptEdits: keptEdits, ignoredCount: ignoredCount };
}

// ─── Helpers for replayAndVerify ────────────────────────────────────────────

// Build the verification result object.
function buildReplayVsOnDiskComparisonResult(filename, fileEdits, filtered, replayedContent, onDiskContent) {
  var match = replayedContent === onDiskContent;
  return {
    filename: filename, totalEdits: fileEdits.length,
    kept: filtered.keptEdits.length, ignored: filtered.ignoredCount,
    match: match, replayedContent: replayedContent,
    diff: match ? '' : computeDiff(onDiskContent, replayedContent)
  };
}

// Filter edits to a target file if specified.
function filterEditsToFile(allEdits, targetFile) {
  if (!targetFile) { return allEdits; }
  return allEdits.filter(function(e) { return e.file === targetFile; });
}

// Replay and verify a single JSONL against on-disk content.
function replayAndVerify(jsonlText, onDiskContent, targetFile) {
  var allEdits = extractEditsFromJSONL(jsonlText);
  var classification = analyzeJSONL(jsonlText);
  var fileEdits = filterEditsToFile(allEdits, targetFile);
  var filtered = filterKeptEdits(fileEdits, classification.edits);
  var replayedContent = replayEdits(filtered.keptEdits);
  var filename = fileEdits.length > 0 ? fileEdits[0].file : '';
  return buildReplayVsOnDiskComparisonResult(filename, fileEdits, filtered, replayedContent, onDiskContent);
}

// ─── Cumulative multi-session replay ──────────────────────────────────────

// Return indices of sessions (in jsonlTexts array) that contain edits for targetFile.
function collectSessionsForFile(jsonlTexts, targetFile) {
  var indices = [];
  for (var i = 0; i < jsonlTexts.length; i++) {
    var edits = extractEditsFromJSONL(jsonlTexts[i]);
    var fileEdits = filterEditsToFile(edits, targetFile);
    if (fileEdits.length > 0) { indices.push(i); }
  }
  return indices;
}

// Extract kept edits for targetFile from a single JSONL text (returns the kept
// edit array). Private to cumulative replay; the exported path-based
// extractKeptEditsForFile lives in api/edit-stream-extraction.js.
function extractKeptEditsFromJsonlText(jsonlText, targetFile) {
  var allEdits = extractEditsFromJSONL(jsonlText);
  var classification = analyzeJSONL(jsonlText);
  var fileEdits = filterEditsToFile(allEdits, targetFile);
  var filtered = filterKeptEdits(fileEdits, classification.edits);
  return filtered.keptEdits;
}

// Replay edits from multiple JSONL sessions and verify against on-disk content.
function replayAndVerifyCumulative(jsonlTexts, onDiskContent, targetFile) {
  var allKept = [];
  for (var i = 0; i < jsonlTexts.length; i++) {
    var kept = extractKeptEditsFromJsonlText(jsonlTexts[i], targetFile);
    for (var j = 0; j < kept.length; j++) { allKept.push(kept[j]); }
  }
  var replayedContent = replayEdits(allKept);
  var match = replayedContent === onDiskContent;
  return {
    filename: targetFile, totalEdits: allKept.length,
    kept: allKept.length, ignored: 0, match: match,
    replayedContent: replayedContent,
    diff: match ? '' : computeDiff(onDiskContent, replayedContent)
  };
}

// ─── Helpers for verifyAllJsonlFilesAgainstDisk ────────────────────────────────────────────────

// Build a unique-files map from edits with create/edit type.
function buildUniqueFilesMap(edits) {
  var uniqueFiles = {};
  for (var i = 0; i < edits.length; i++) {
    if (edits[i].file && (edits[i].type === 'create' || edits[i].type === 'edit')) {
      uniqueFiles[edits[i].file] = true;
    }
  }
  return uniqueFiles;
}

// Collect unique target filenames from create/edit operations.
function collectTargetFiles(edits) {
  var targetFiles = Object.keys(buildUniqueFilesMap(edits));
  if (targetFiles.length === 0 && edits.length > 0) { targetFiles = [edits[0].file]; }
  return targetFiles;
}

// Build a "not found" result entry for a missing file.
function buildNotFoundResult(jsonlFile, targetFile, edits) {
  return {
    jsonlFile: jsonlFile, filename: targetFile, totalEdits: edits.length,
    kept: 0, ignored: 0, match: false, replayedContent: '',
    diff: targetFile + ' not found on disk or in file-history', error: 'file not found'
  };
}

// Verify via snapshot when the file is not on disk.
function verifyViaSnapshot(jsonlText, jsonlFile, targetFile) {
  var r = replayAndVerify(jsonlText, findLastSnapshotContent(jsonlText, targetFile), targetFile);
  r.jsonlFile = jsonlFile;
  r.note = 'compared against file-history snapshot (file not on disk)';
  return r;
}

// Build git options from CLI args and JSONL metadata.
function buildGitRepoAndBranchOptions(jsonlText, edits, cliGitRepo, cliGitBranch) {
  var meta = extractSessionMetadata(jsonlText);
  var repo = cliGitRepo || meta.cwd || null;
  var branch = cliGitBranch || meta.gitBranch || null;
  if (!repo || !branch) { return null; }
  return { repoRoot: repo, gitBranch: branch, filePathMap: gitState.buildFilePathMap(edits) };
}

// Try git fallback: resolve content from git, replay and verify.
function tryGitFallback(jsonlText, jsonlFile, targetFile, gitOpts) {
  if (!gitOpts) { return null; }
  var content = gitState.resolveGitContent(targetFile, gitOpts.filePathMap, gitOpts.repoRoot, gitOpts.gitBranch);
  if (content === null) { return null; }
  var r = replayAndVerify(jsonlText, content, targetFile);
  r.jsonlFile = jsonlFile;
  r.note = 'compared against git show ' + gitOpts.gitBranch;
  return r;
}

// Handle verification when the target file does not exist on disk.
function verifyMissingFile(jsonlText, jsonlFile, edits, targetFile, results, gitOpts) {
  var snapshotContent = findLastSnapshotContent(jsonlText, targetFile);
  if (snapshotContent !== null) {
    results.push(verifyViaSnapshot(jsonlText, jsonlFile, targetFile));
    return;
  }
  var gitResult = tryGitFallback(jsonlText, jsonlFile, targetFile, gitOpts);
  if (gitResult) { results.push(gitResult); return; }
  results.push(buildNotFoundResult(jsonlFile, targetFile, edits));
}

// Try snapshot fallback when on-disk comparison yields a mismatch.
function trySnapshotFallback(jsonlText, jsonlFile, targetFile, result) {
  var fallbackContent = findLastSnapshotContent(jsonlText, targetFile);
  if (fallbackContent !== null) {
    var fb = replayAndVerify(jsonlText, fallbackContent, targetFile);
    if (fb.match) {
      fb.jsonlFile = jsonlFile;
      fb.note = 'compared against file-history snapshot (on-disk file stale)';
      return fb;
    }
  }
  return result;
}

// Verify a single target file that exists on disk.
function verifyOnDiskFile(jsonlText, jsonlFile, targetFile, onDiskPath, results, gitOpts) {
  var onDiskContent = fs.readFileSync(onDiskPath, 'utf8');
  var result = replayAndVerify(jsonlText, onDiskContent, targetFile);
  result.jsonlFile = jsonlFile;
  if (!result.match) { result = trySnapshotFallback(jsonlText, jsonlFile, targetFile, result); }
  if (!result.match) {
    var gr = tryGitFallback(jsonlText, jsonlFile, targetFile, gitOpts);
    if (gr && gr.match) { result = gr; }
  }
  results.push(result);
}

// Process all target files for a single JSONL file.
function processJsonlTargets(jsonlText, jsonlFile, edits, filesDir, results, gitOpts) {
  var targetFiles = collectTargetFiles(edits);
  for (var tf = 0; tf < targetFiles.length; tf++) {
    var onDiskPath = path.join(filesDir, targetFiles[tf]);
    if (!fs.existsSync(onDiskPath)) {
      verifyMissingFile(jsonlText, jsonlFile, edits, targetFiles[tf], results, gitOpts);
    } else {
      verifyOnDiskFile(jsonlText, jsonlFile, targetFiles[tf], onDiskPath, results, gitOpts);
    }
  }
}

// Process a single JSONL file during batch verification.
function processSingleJsonlFile(jsonlDir, jsonlFile, filesDir, results, cliGitRepo, cliGitBranch) {
  var jsonlText = fs.readFileSync(path.join(jsonlDir, jsonlFile), 'utf8');
  var edits = extractEditsFromJSONL(jsonlText);
  if (edits.length === 0) { return; }
  var gitOpts = buildGitRepoAndBranchOptions(jsonlText, edits, cliGitRepo, cliGitBranch);
  processJsonlTargets(jsonlText, jsonlFile, edits, filesDir, results, gitOpts);
}

// Batch verify a directory pair.
function verifyAllJsonlFilesAgainstDisk(jsonlDir, filesDir, cliGitRepo, cliGitBranch) {
  var jsonlFiles = fs.readdirSync(jsonlDir).filter(function (f) { return f.endsWith('.jsonl'); });
  var results = [];
  for (var i = 0; i < jsonlFiles.length; i++) {
    processSingleJsonlFile(jsonlDir, jsonlFiles[i], filesDir, results, cliGitRepo, cliGitBranch);
  }
  return results;
}

// ─── Format helpers ─────────────────────────────────────────────────────────

// Format a single result entry into report lines.
function formatSingleResult(r) {
  var lines = [];
  lines.push((r.jsonlFile || '?') + ' -> ' + r.filename);
  lines.push('  Edits: ' + r.totalEdits + ' total, ' + r.kept + ' kept, ' + r.ignored + ' ignored');
  lines.push('  Replay: ' + (r.match ? 'MATCH' : 'MISMATCH'));
  if (!r.match && r.diff) { lines.push('  ' + r.diff.split('\n').join('\n  ')); }
  lines.push('');
  return lines;
}

// Format batch results as a report string.
function formatResults(results) {
  var lines = [];
  for (var i = 0; i < results.length; i++) {
    var entry = formatSingleResult(results[i]);
    for (var j = 0; j < entry.length; j++) { lines.push(entry[j]); }
  }
  return lines.join('\n');
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    replayAndVerify: replayAndVerify,
    replayAndVerifyCumulative: replayAndVerifyCumulative,
    verifyAllJsonlFilesAgainstDisk: verifyAllJsonlFilesAgainstDisk,
    formatResults: formatResults,
    collectSessionsForFile: collectSessionsForFile
  };
}
