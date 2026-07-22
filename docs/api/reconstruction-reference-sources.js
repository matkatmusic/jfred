// reconstruction-reference-sources: what to compare a reconstruction against,
// and the verdict. Probes on-disk / file-history snapshot / git for one file,
// picks the reference that matches, and reports provenance. Moved (Phase 5) from
// tools/probe-reference-sources.js (gathering + selection) + the findLastSnapshot*
// family from common/extract-file-state.js. Snapshot-store IO comes from
// api/snapshot-store-io.js; git from api/git-file-state.js. No console/argv.
//
// EVERY source is probed for availability first (no short-circuit), so the
// per-file record can show what was available, what was used, and what was
// skipped — a reconstruction source skipped accidentally is visible, not silent.

var fs = require('fs');
var path = require('path');
var gitState = require('./git-file-state');
var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;
var snapshotStore = require('./snapshot-store-io');
var getDefaultBaseHistoryDir = snapshotStore.getDefaultBaseHistoryDir;
var getSnapshotBackups = snapshotStore.getSnapshotBackups;

// ─── Selection (pure) ───────────────────────────────────────────────────────

// Human label for each source name, used in comparedVia and skipped notes.
var COMPARED_VIA_BY_SOURCE = { onDisk: 'on-disk', snapshot: 'snapshot', git: 'git' };

// The first available source whose content equals the replay, or null.
function findFirstContentMatchingReferenceSource(replayedContent, sources) {
  for (var i = 0; i < sources.length; i++) {
    if (!sources[i].available) { continue; }
    if (sources[i].content === replayedContent) { return sources[i]; }
  }
  return null;
}

// The first available source regardless of content, or null.
function findFirstAvailableReferenceSource(sources) {
  for (var i = 0; i < sources.length; i++) {
    if (sources[i].available) { return sources[i]; }
  }
  return null;
}

// Availability notes for every available-but-unused source, e.g.
// "snapshot available but on-disk used".
function buildSkippedNotes(sources, usedSource) {
  var skipped = [];
  if (!usedSource) { return skipped; }
  for (var i = 0; i < sources.length; i++) {
    if (!sources[i].available) { continue; }
    if (sources[i] === usedSource) { continue; }
    skipped.push(sources[i].name + ' available but ' + COMPARED_VIA_BY_SOURCE[usedSource.name] + ' used');
  }
  return skipped;
}

// The per-file dataSources block: availability + identity detail + used flag
// for every source, plus the skipped notes.
function buildDataSourcesBlock(sources, usedSource, skipped) {
  var block = { skipped: skipped };
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    var entry = { available: s.available, used: s === usedSource };
    if (s.name === 'onDisk') { entry.path = s.path; }
    if (s.name === 'snapshot') { entry.blob = s.blob; }
    if (s.name === 'git') { entry.ref = s.ref; }
    block[s.name] = entry;
  }
  return block;
}

// Decide which reference source verifies the replayed content. Returns
// { status, comparedVia, usedSource, dataSources }.
function chooseReferenceSource(replayedContent, sources) {
  var match = findFirstContentMatchingReferenceSource(replayedContent, sources);
  var usedSource = match || findFirstAvailableReferenceSource(sources);
  var status = match ? 'PASS' : (usedSource ? 'MISMATCH' : 'NOT_FOUND');
  var skipped = buildSkippedNotes(sources, usedSource);
  return {
    status: status,
    comparedVia: usedSource ? COMPARED_VIA_BY_SOURCE[usedSource.name] : 'none',
    usedSource: usedSource || null,
    dataSources: buildDataSourcesBlock(sources, usedSource, skipped)
  };
}

// ─── Gathering (I/O) ────────────────────────────────────────────────────────

// Distinct basenames across a file's alias paths, most recent name first
// (snapshot/git stores key by basename; the current name is the likeliest hit).
function distinctBasenames(aliasPaths, lastSeenFullPath) {
  var names = [];
  if (lastSeenFullPath) { names.push(path.basename(lastSeenFullPath)); }
  for (var i = 0; i < aliasPaths.length; i++) {
    var name = path.basename(aliasPaths[i]);
    if (names.indexOf(name) < 0) { names.push(name); }
  }
  return names;
}

// Probe the on-disk reference: where the file lives NOW (following renames).
function gatherOnDiskSource(lastSeenFullPath) {
  if (!lastSeenFullPath) {
    return { name: 'onDisk', available: false, content: null, path: null };
  }
  if (!fs.existsSync(lastSeenFullPath)) {
    return { name: 'onDisk', available: false, content: null, path: null };
  }
  return {
    name: 'onDisk', available: true,
    content: fs.readFileSync(lastSeenFullPath, 'utf8'), path: lastSeenFullPath
  };
}

// Try ONE transcript for a snapshot blob of any of the file's basenames.
function gatherSnapshotSourceFromTranscript(transcriptText, basenames, snapshotBaseDir) {
  for (var b = 0; b < basenames.length; b++) {
    var blob = findLastSnapshotBlob(transcriptText, basenames[b], snapshotBaseDir);
    if (!blob) { continue; }
    return {
      name: 'snapshot', available: true, content: blob.content,
      blob: { sessionId: blob.sessionId, backupFileName: blob.backupFileName }
    };
  }
  return null;
}

// Probe the snapshot reference: scan the file's transcripts most-recent-first
// for a file-history snapshot blob of any of its basenames.
function gatherSnapshotSource(transcriptTexts, basenames, snapshotBaseDir) {
  for (var t = transcriptTexts.length - 1; t >= 0; t--) {
    var source = gatherSnapshotSourceFromTranscript(transcriptTexts[t].text, basenames, snapshotBaseDir);
    if (source) { return source; }
  }
  return { name: 'snapshot', available: false, content: null, blob: null };
}

// Try every multi-ref candidate in order so the WINNING ref is known (the
// provenance needs it; resolveGitContentMultiRef hides which ref hit).
function resolveGitContentWithRef(basename, filePathMap, repoRoot, refs) {
  for (var r = 0; r < refs.length; r++) {
    var content = gitState.resolveGitContent(basename, filePathMap, repoRoot, refs[r]);
    if (content !== null) { return { content: content, ref: refs[r] }; }
  }
  return null;
}

// Try ONE transcript's git session metadata for any of the file's basenames.
// null when the session has no usable git context or no ref holds the file.
function gatherGitSourceFromTranscript(transcriptText, basenames, edits) {
  var meta = extractSessionMetadata(transcriptText);
  if (!meta.gitBranch) { return null; }
  if (!meta.cwd) { return null; }
  var repoRoot = gitState.resolveRepoRootWalkingUp(meta.cwd);
  if (!repoRoot) { return null; }
  var refs = gitState.buildGitRefFallbackList(meta.gitBranch);
  var filePathMap = gitState.buildFilePathMap(edits);
  for (var b = 0; b < basenames.length; b++) {
    var hit = resolveGitContentWithRef(basenames[b], filePathMap, repoRoot, refs);
    if (hit) { return { name: 'git', available: true, content: hit.content, ref: hit.ref }; }
  }
  return null;
}

// Probe the git reference: scan transcripts most-recent-first for session git
// metadata, then try the file's basenames against that session's refs.
function gatherGitSource(transcriptTexts, basenames, perTranscriptEdits) {
  for (var t = transcriptTexts.length - 1; t >= 0; t--) {
    var edits = perTranscriptEdits[transcriptTexts[t].file].edits;
    var source = gatherGitSourceFromTranscript(transcriptTexts[t].text, basenames, edits);
    if (source) { return source; }
  }
  return { name: 'git', available: false, content: null, ref: null };
}

// Read each of the file's ordered transcripts once for source probing.
function loadTranscriptTexts(orderedTranscripts) {
  return orderedTranscripts.map(function (t) {
    return { file: t.transcriptPath, text: fs.readFileSync(t.transcriptPath, 'utf8') };
  });
}

// Probe ALL reference sources for one file (on-disk, snapshot, git) — every
// source's availability is recorded even when an earlier one already matched.
function gatherReferenceSources(lastSeenFullPath, aliasPaths, orderedTranscripts, perTranscriptEdits, snapshotBaseDir) {
  var transcriptTexts = loadTranscriptTexts(orderedTranscripts);
  var basenames = distinctBasenames(aliasPaths, lastSeenFullPath);
  return [
    gatherOnDiskSource(lastSeenFullPath),
    gatherSnapshotSource(transcriptTexts, basenames, snapshotBaseDir),
    gatherGitSource(transcriptTexts, basenames, perTranscriptEdits)
  ];
}

// ─── findLastSnapshot* (from common/extract-file-state.js) ───────────────────

// Safely parse a single JSON line. Returns the object or null.
function tryParseJson(line) {
  try {
    return JSON.parse(line);
  } catch (e) {
    return null;
  }
}

// Parse JSONL text into an array of objects and extract sessionId.
function loadJsonlWithSession(jsonlText) {
  var lines = jsonlText.split('\n').filter(Boolean);
  var sessionId = '';
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    var obj = tryParseJson(lines[i]);
    if (obj && !sessionId && obj.sessionId) {
      sessionId = obj.sessionId;
    }
    parsed.push(obj);
  }
  return { parsed: parsed, sessionId: sessionId };
}

// The backupFileName for one backups entry whose basename matches targetFile,
// or null. (Flattened from a triple-nested if to satisfy the nesting/one-condition
// hooks; behavior identical to the original extract-file-state.js version.)
function backupNameIfBasenameMatches(key, entry, targetFile) {
  if (key.split('/').pop() !== targetFile) { return null; }
  if (!entry) { return null; }
  if (!entry.backupFileName) { return null; }
  return entry.backupFileName;
}

// Search a backups map for a key whose basename matches targetFile.
// Returns the LAST matching backupFileName, or null.
function findBackupByBasename(backups, targetFile) {
  var found = null;
  var keys = Object.keys(backups);
  for (var k = 0; k < keys.length; k++) {
    var name = backupNameIfBasenameMatches(keys[k], backups[keys[k]], targetFile);
    if (name) { found = name; }
  }
  return found;
}

// Search snapshot backups for the last matching targetFile.
function findLastBackupFileName(parsed, targetFile) {
  var lastBackupFileName = null;
  for (var i = 0; i < parsed.length; i++) {
    var backups = getSnapshotBackups(parsed[i]);
    if (!backups) {
      continue;
    }
    var match = findBackupByBasename(backups, targetFile);
    if (match) {
      lastBackupFileName = match;
    }
  }
  return lastBackupFileName;
}

// Locate the last file-history snapshot of targetFile in this transcript and
// report exactly which blob holds it: {sessionId, backupFileName, content}.
// null when no snapshot is recorded or the blob file is missing on disk.
function findLastSnapshotBlob(jsonlText, targetFile, baseHistoryDir) {
  var result = loadJsonlWithSession(jsonlText);
  var lastBackupFileName = findLastBackupFileName(result.parsed, targetFile);
  if (!result.sessionId || !lastBackupFileName) { return null; }
  if (typeof require === 'undefined' || !fs || !path) { return null; }
  var base = baseHistoryDir || getDefaultBaseHistoryDir();
  var backupPath = path.join(base, result.sessionId, lastBackupFileName);
  if (!fs.existsSync(backupPath)) { return null; }
  return {
    sessionId: result.sessionId,
    backupFileName: lastBackupFileName,
    content: fs.readFileSync(backupPath, 'utf8')
  };
}

// Content-only convenience over findLastSnapshotBlob (original API).
function findLastSnapshotContent(jsonlText, targetFile, baseHistoryDir) {
  var blob = findLastSnapshotBlob(jsonlText, targetFile, baseHistoryDir);
  return blob === null ? null : blob.content;
}

module.exports = {
  chooseReferenceSource: chooseReferenceSource,
  gatherReferenceSources: gatherReferenceSources,
  distinctBasenames: distinctBasenames,
  findLastSnapshotContent: findLastSnapshotContent,
  findLastSnapshotBlob: findLastSnapshotBlob
};
