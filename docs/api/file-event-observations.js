// The raw observation extractors: turn JSONL tool records into implicit
// "update" edits from the three observation sources —
//   - Bash cat commands (cat tool output)
//   - Read tool results
//   - file-history-snapshot backups from the file-history store
// Moved (Phase 4) from common/extract-file-state.js. The snapshot-store IO
// helpers (resolveHistoryDir / readBackupFile) and the record-shape helper
// getSnapshotBackups now live in their permanent home api/snapshot-store-io.js
// (Phase 5), shared with api/reconstruction-reference-sources (findLastSnapshot*).

var resolveHistoryDir, readBackupFile, getSnapshotBackups;
if (typeof module !== 'undefined' && typeof require === 'function') {
  var snapshotStore = require('./snapshot-store-io');
  resolveHistoryDir = snapshotStore.resolveHistoryDir;
  readBackupFile = snapshotStore.readBackupFile;
  getSnapshotBackups = snapshotStore.getSnapshotBackups;
}

// ─── Shared constants ──────────────────────────────────────────────────────
var LINE_NUMBER_PATTERN = /^\s*\d+\s*(?:│ ?|\t)/;
var CAT_COMMAND_PATTERN = /^cat\s+(?:-[a-zA-Z]+\s+)*(\S+)\s*$/;

// ─── Shared helpers ────────────────────────────────────────────────────────

// Return the first non-empty line from an array of strings, or ''.
function findFirstNonEmptyLine(lines) {
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      return lines[i];
    }
  }
  return '';
}

// Strip the line-number prefix from every line in an array.
function stripPrefixFromLines(lines) {
  var stripped = [];
  for (var i = 0; i < lines.length; i++) {
    stripped.push(lines[i].replace(LINE_NUMBER_PATTERN, ''));
  }
  return stripped;
}

// Return obj.message.content when it is a valid array, otherwise null.
function getMessageContent(obj) {
  if (!obj) {
    return null;
  }
  if (!obj.message) {
    return null;
  }
  var content = obj.message.content;
  if (!Array.isArray(content)) {
    return null;
  }
  return content;
}

// Build an edit record from a file path, line index, content, and optional source tag.
function buildEditRecord(lineIndex, filePath, content, source) {
  var edit = {
    line: lineIndex,
    filePath: filePath,
    file: filePath.split('/').pop(),
    type: 'update',
    content: content
  };
  if (source) {
    edit.source = source;
  }
  return edit;
}

// Register a tool_use item into pendingMap if it matches toolName.
function registerToolUse(item, toolName, pendingMap, onToolUse, lineIndex) {
  if (item.type !== 'tool_use') {
    return;
  }
  if (item.name !== toolName) {
    return;
  }
  var pending = onToolUse(item, lineIndex);
  if (pending) {
    pendingMap[item.id] = pending;
  }
}

// Confirm a tool_result item against pendingMap, returning an edit or null.
function confirmToolResult(item, obj, pendingMap, onToolResult, edits, lineIndex) {
  if (item.type !== 'tool_result') {
    return;
  }
  if (!pendingMap[item.tool_use_id]) {
    return;
  }
  var edit = onToolResult(item, obj, pendingMap[item.tool_use_id], lineIndex);
  if (edit) {
    edits.push(edit);
  }
  delete pendingMap[item.tool_use_id];
}

// Iterate parsed JSONL objects and run tool_use/tool_result callbacks.
// onToolUse(item, lineIndex) should return a pending entry or null.
// onToolResult(item, obj, pending, lineIndex) should return an edit or null.
function scanToolUseResults(parsed, toolName, onToolUse, onToolResult) {
  var pendingMap = {};
  var edits = [];
  for (var i = 0; i < parsed.length; i++) {
    var content = getMessageContent(parsed[i]);
    if (!content) {
      continue;
    }
    for (var c = 0; c < content.length; c++) {
      registerToolUse(content[c], toolName, pendingMap, onToolUse, i);
      confirmToolResult(content[c], parsed[i], pendingMap, onToolResult, edits, i);
    }
  }
  return edits;
}

// ─── Strip line-number prefixes from cat -n output ─────────────────────────
// Handles both " 1 │ content" (unicode box) and "  1\tcontent" (tab) formats.
// If the first non-empty line doesn't match a line-number pattern, returns unchanged.
function stripCatLineNumbers(stdout) {
  if (!stdout) {
    return '';
  }
  var lines = stdout.split('\n');
  var firstNonEmpty = findFirstNonEmptyLine(lines);
  if (!LINE_NUMBER_PATTERN.test(firstNonEmpty)) {
    return stdout;
  }
  return stripPrefixFromLines(lines).join('\n');
}

// ─── Bash cat tool_use pending-entry builder ───────────────────────────────
function buildCatPending(item, lineIndex) {
  if (!item.input) {
    return null;
  }
  var cmd = item.input.command || '';
  var match = CAT_COMMAND_PATTERN.exec(cmd);
  if (!match) {
    return null;
  }
  return { filePath: match[1], line: lineIndex };
}

// ─── Bash cat tool_result handler ──────────────────────────────────────────
function confirmCatResult(item, obj, pending, lineIndex) {
  var stdout = '';
  if (typeof item.content === 'string') {
    stdout = item.content;
  }
  if (!stdout && obj.toolUseResult) {
    stdout = obj.toolUseResult.stdout || '';
  }
  var strippedContent = stripCatLineNumbers(stdout);
  // 'cat' tags this as an observation (a read), not authored content; replay
  // treats it like any other content checkpoint.
  return buildEditRecord(lineIndex, pending.filePath, strippedContent, 'cat');
}

// ─── Extract Bash cat snapshots from JSONL ─────────────────────────────────
// Finds Bash tool_use lines with cat commands, links to their tool_result,
// and returns implicit "update" edits with the stripped stdout content.
function extractBashCatEdits(lines, parsed) {
  return scanToolUseResults(parsed, 'Bash', buildCatPending, confirmCatResult);
}

// Read tool_use/tool_result extraction was UNIFIED into api/read-event-scanner.js
// by Item 17 (buildReadPending / confirmReadResult / extractReadEdits removed; the
// legacy bodies are preserved in archive/read-scanner-legacy-bodies.js).

// Try to build a snapshot edit from a single backup entry. Returns edit or null.
function buildSnapshotEdit(filePath, entry, historyDir, lineIndex) {
  if (!entry) {
    return null;
  }
  if (!entry.backupFileName) {
    return null;
  }
  var backupContent = readBackupFile(historyDir, entry.backupFileName);
  if (backupContent === null) {
    return null;
  }
  return buildEditRecord(lineIndex, filePath, backupContent, 'snapshot');
}

// Collect edits from a single snapshot's trackedFileBackups.
function collectSnapshotBackupEdits(backups, historyDir, lineIndex) {
  var edits = [];
  var files = Object.keys(backups);
  for (var f = 0; f < files.length; f++) {
    var edit = buildSnapshotEdit(files[f], backups[files[f]], historyDir, lineIndex);
    if (edit) {
      edits.push(edit);
    }
  }
  return edits;
}

// ─── Extract file-history-snapshot backups from JSONL ──────────────────────
// When a file-history-snapshot has a non-null backupFileName for a tracked file,
// the actual file content lives at <historyDir>/<backupFileName>. We read these
// and inject them as implicit "update" edits with source='snapshot'.
function extractSnapshotEdits(lines, parsed, sessionId, baseHistoryDir) {
  var historyDir = resolveHistoryDir(sessionId, baseHistoryDir);
  if (!historyDir) {
    return [];
  }
  var edits = [];
  for (var i = 0; i < parsed.length; i++) {
    var backups = getSnapshotBackups(parsed[i]);
    if (!backups) {
      continue;
    }
    Array.prototype.push.apply(edits, collectSnapshotBackupEdits(backups, historyDir, i));
  }
  return edits;
}

// ─── Exports ───────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    stripCatLineNumbers: stripCatLineNumbers,
    buildEditRecord: buildEditRecord,
    scanToolUseResults: scanToolUseResults,
    extractBashCatEdits: extractBashCatEdits,
    extractSnapshotEdits: extractSnapshotEdits
  };
}
