// Unified reconstruction: per-source-type step extractors and matching primitives.
// Split from unified-reconstruct-steps.js (which kept the orchestration) to stay
// under the file-size cap. Holds the step factory, target/path matchers, and the
// edit/read/cat record extractors; orchestration lives in the sibling module.

var fs, path, stripCatLineNumbers, resolveAgainstCwd;
if (typeof module !== 'undefined' && typeof require === 'function') {
  fs = require('fs');
  path = require('path');
  stripCatLineNumbers = require('./file-event-observations').stripCatLineNumbers;
  resolveAgainstCwd = require('./file-historical-lineage').resolveAgainstCwd;
}

var CAT_CMD_PATTERN = /^cat\s+(?:-[a-zA-Z]+\s+)*(\S+)\s*$/;

// ─── Step factory and helpers ─────────────────────────────────────────────────

function buildStep(line, timestamp, sourceFile, fields) {
  return {
    line: line,
    timestamp: timestamp,
    sourceFile: sourceFile,
    snapshot: fields.snapshot || null,
    originalFile: fields.originalFile || null,
    readResult: fields.readResult || null,
    bashReadResult: fields.bashReadResult || null,
    structuredPatch: fields.structuredPatch || null,
    edit: fields.edit || null,
    bashFileOp: fields.bashFileOp || null
  };
}

function tryParseUnified(line) {
  try { return JSON.parse(line); }
  catch (e) { return null; }
}

// Full-path equality only; basename matching is the collision bug v2 killed.
function doesMatchTargetFile(filePath, targetFile) {
  return filePath === targetFile;
}

// Snapshot keys are repo-relative: match exact OR full relative-path suffix
// (whole path must match, so a shared basename alone is rejected).
function doesSnapshotKeyMatchTarget(key, targetFile) {
  return key === targetFile || targetFile.endsWith('/' + key);
}

function getMessageContentArray(obj) {
  var msg = obj.message;
  if (!msg) { return null; }
  var content = msg.content;
  if (!Array.isArray(content)) { return null; }
  return content;
}

function isValidReadOutput(content) {
  if (!content) { return false; }
  var lines = content.split('\n');
  if (lines.length < 2) { return false; }
  var firstLine = lines[0].trim();
  if (/^\d+\t/.test(firstLine)) { return true; }
  return false;
}

function parseUnifiedJsonlLines(lines) {
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    parsed.push(tryParseUnified(lines[i]));
  }
  return parsed;
}

function extractSessionId(parsed) {
  for (var i = 0; i < parsed.length; i++) {
    if (!parsed[i]) { continue; }
    if (parsed[i].sessionId) { return parsed[i].sessionId; }
  }
  return null;
}

function readSnapshotBackup(backupFileName, sessionId) {
  if (!fs || !path) { return null; }
  var home = process.env.HOME || '';
  var backupPath = path.join(home, '.claude', 'file-history', sessionId || '', backupFileName);
  try { return fs.readFileSync(backupPath, 'utf8'); }
  catch (e) { return null; }
}

function getSnapshotContentForFile(snapshotObj, targetFile, sessionId) {
  if (!snapshotObj) { return null; }
  var files = snapshotObj.trackedFileBackups || snapshotObj.files;
  if (!files) { return null; }
  var keys = Object.keys(files);
  for (var k = 0; k < keys.length; k++) {
    if (!doesSnapshotKeyMatchTarget(keys[k], targetFile)) { continue; }
    var entry = files[keys[k]];
    if (entry.content !== undefined) { return entry.content; }
    if (entry.backupFileName) {
      var backup = readSnapshotBackup(entry.backupFileName, sessionId);
      if (backup !== null) { return backup; }
    }
  }
  return null;
}

// ─── Edit step extraction ─────────────────────────────────────────────────────

function buildEditObject(tr) {
  return {
    type: tr.type || 'edit', content: tr.content,
    oldString: tr.oldString !== undefined ? tr.oldString : tr.old_string,
    newString: tr.newString !== undefined ? tr.newString : tr.new_string,
    replaceAll: tr.replaceAll || tr.replace_all || false,
    originalFile: tr.originalFile || null
  };
}

function buildEditStep(tr, lineIdx, timestamp, targetFile, sourcePath) {
  var relevant = tr.type === 'create' || tr.type === 'update' || tr.oldString !== undefined || tr.old_string !== undefined;
  if (!relevant) { return null; }
  var filePath = tr.filePath || '';
  if (!doesMatchTargetFile(filePath, targetFile)) { return null; }
  var extractOrigFile = (tr.originalFile && tr.originalFile.length > 0) ? tr.originalFile : null;
  var buildPatchFixture = (tr.structuredPatch && tr.structuredPatch.length > 0) ? tr.structuredPatch : null;
  return buildStep(lineIdx, timestamp, sourcePath, {
    edit: buildEditObject(tr),
    originalFile: extractOrigFile,
    structuredPatch: buildPatchFixture
  });
}

// ─── Read step extraction ─────────────────────────────────────────────────────

function checkReadToolUse(item, lineIdx, targetFile, pending) {
  if (item.type !== 'tool_use') { return; }
  if (item.name !== 'Read') { return; }
  if (!item.input) { return; }
  var fp = item.input.file_path || '';
  if (!doesMatchTargetFile(fp, targetFile)) { return; }
  pending[item.id] = { line: lineIdx };
}

function resolveReadContent(item) {
  var content = '';
  if (typeof item.content === 'string') { content = item.content; }
  if (!isValidReadOutput(content)) { return null; }
  return stripCatLineNumbers(content);
}

function checkReadToolResult(item, obj, lineIdx, ts, sourcePath, pending, steps) {
  if (item.type !== 'tool_result') { return; }
  if (!pending[item.tool_use_id]) { return; }
  var stripped = resolveReadContent(item);
  if (stripped === null) { delete pending[item.tool_use_id]; return; }
  steps.push(buildStep(lineIdx, ts, sourcePath, { readResult: stripped }));
  delete pending[item.tool_use_id];
}

// ─── Cat step extraction ──────────────────────────────────────────────────────

function checkCatToolUse(item, lineIdx, targetFile, cwd, pending) {
  if (item.type !== 'tool_use') { return; }
  if (item.name !== 'Bash') { return; }
  if (!item.input) { return; }
  var cmd = item.input.command || '';
  var match = CAT_CMD_PATTERN.exec(cmd);
  if (!match) { return; }
  // cat paths may be relative; resolve against session cwd before exact match.
  var catPath = resolveAgainstCwd ? resolveAgainstCwd(cwd, match[1]) : match[1];
  if (!doesMatchTargetFile(catPath, targetFile)) { return; }
  pending[item.id] = { line: lineIdx };
}

function resolveCatContent(item, obj) {
  var stdout = '';
  if (typeof item.content === 'string') { stdout = item.content; }
  if (!stdout && obj.toolUseResult) { stdout = obj.toolUseResult.stdout || ''; }
  return stripCatLineNumbers(stdout);
}

function checkCatToolResult(item, obj, lineIdx, ts, sourcePath, pending, steps) {
  if (item.type !== 'tool_result') { return; }
  if (!pending[item.tool_use_id]) { return; }
  var stripped = resolveCatContent(item, obj);
  steps.push(buildStep(lineIdx, ts, sourcePath, { bashReadResult: stripped }));
  delete pending[item.tool_use_id];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildStep: buildStep,
    tryParseUnified: tryParseUnified,
    doesMatchTargetFile: doesMatchTargetFile,
    doesSnapshotKeyMatchTarget: doesSnapshotKeyMatchTarget,
    getMessageContentArray: getMessageContentArray,
    isValidReadOutput: isValidReadOutput,
    parseUnifiedJsonlLines: parseUnifiedJsonlLines,
    extractSessionId: extractSessionId,
    getSnapshotContentForFile: getSnapshotContentForFile,
    buildEditObject: buildEditObject,
    buildEditStep: buildEditStep,
    checkReadToolUse: checkReadToolUse,
    checkReadToolResult: checkReadToolResult,
    checkCatToolUse: checkCatToolUse,
    checkCatToolResult: checkCatToolResult
  };
}
