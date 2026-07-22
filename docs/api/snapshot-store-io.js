// snapshot-store-io: read the file-history snapshot store and the snapshot
// record shape. The shared leaf used by both api/file-event-observations
// (extractSnapshotEdits) and api/reconstruction-reference-sources
// (findLastSnapshot*). Moved (Phase 5) from common/extract-file-state.js,
// bodies unchanged.
//
// The file-history store lives at <baseHistoryDir>/<sessionId>/<backupFileName>
// (default base ~/.claude/file-history). A file-history-snapshot record carries
// a trackedFileBackups map of tracked path -> { backupFileName }.

var fs, path;
if (typeof module !== 'undefined' && typeof require === 'function') {
  fs = require('fs');
  path = require('path');
}

// The default file-history root when no override is supplied: ~/.claude/file-history.
function getDefaultBaseHistoryDir() {
  return path.join(require('os').homedir(), '.claude', 'file-history');
}

// Resolve the file-history directory for a given sessionId, under baseHistoryDir
// (defaults to ~/.claude/file-history). Returns null if missing. baseHistoryDir
// lets callers point at a relocated snapshot store (e.g. recovered data whose
// file-history lives beside its projects dir).
function resolveHistoryDir(sessionId, baseHistoryDir) {
  if (!sessionId) { return null; }
  if (typeof require === 'undefined' || !fs || !path) { return null; }
  var base = baseHistoryDir || getDefaultBaseHistoryDir();
  var historyDir = path.join(base, sessionId);
  if (!fs.existsSync(historyDir)) { return null; }
  return historyDir;
}

// Read a backup file and return its content, or null if missing.
function readBackupFile(historyDir, backupFileName) {
  var backupPath = path.join(historyDir, backupFileName);
  if (!fs.existsSync(backupPath)) {
    return null;
  }
  return fs.readFileSync(backupPath, 'utf8');
}

// When a file-history-snapshot has a non-null backupFileName for a tracked file,
// the actual file content lives at <historyDir>/<backupFileName>.
// Return the trackedFileBackups map from a snapshot object, or null if not applicable.
function getSnapshotBackups(obj) {
  if (!obj) {
    return null;
  }
  if (obj.type !== 'file-history-snapshot') {
    return null;
  }
  var snap = obj.snapshot || {};
  return snap.trackedFileBackups || {};
}

// ─── Exports ───────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getDefaultBaseHistoryDir: getDefaultBaseHistoryDir,
    resolveHistoryDir: resolveHistoryDir,
    readBackupFile: readBackupFile,
    getSnapshotBackups: getSnapshotBackups
  };
}
