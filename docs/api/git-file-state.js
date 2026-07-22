// git-file-state: git as an evidence/reference source for JSONL replay.
// Resolves file content from git refs when files aren't on disk, and follows a
// file's git-rename lineage. Moved (Phase 5) from common/git-file-state.js
// (content/ref resolution) + tools/find-jsonls-at-commit.js (the four
// git-rename lineage helpers), bodies unchanged.

var fs, path, cp;
if (typeof module !== 'undefined' && typeof require === 'function') {
  fs = require('fs');
  path = require('path');
  cp = require('child_process');
}

// ─── Content / ref resolution (from common/git-file-state.js) ────────────────

// Strip repo root prefix from an absolute file path, returning the relative path.
function computeRepoRelativePath(filePath, repoRoot) {
  var root = repoRoot.replace(/\/+$/, '');
  if (filePath.indexOf(root + '/') !== 0) { return null; }
  return filePath.substring(root.length + 1);
}

// Run git show to retrieve file content at a specific ref.
function readGitFileContent(repoPath, ref, relativeFilePath) {
  try {
    var cmd = 'git -C ' + JSON.stringify(repoPath) + ' show ' + ref + ':' + relativeFilePath;
    return cp.execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { return null; }
}

// Map basename to first-seen absolute filePath from edits.
function buildFilePathMap(edits) {
  var map = {};
  for (var i = 0; i < edits.length; i++) {
    if (edits[i].file && !map[edits[i].file]) { map[edits[i].file] = edits[i].filePath; }
  }
  return map;
}

// Orchestrate git content resolution: lookup path, compute relative, call git show.
function resolveGitContent(basename, filePathMap, repoRoot, gitBranch) {
  if (!gitBranch) { return null; }
  var fullPath = filePathMap[basename];
  if (!fullPath) { return null; }
  var relPath = computeRepoRelativePath(fullPath, repoRoot);
  if (!relPath) { return null; }
  return readGitFileContent(repoRoot, gitBranch, relPath);
}

// Build a list of git refs to try, ordered by likelihood.
function buildGitRefFallbackList(branch) {
  var refs = [];
  if (branch) {
    refs.push(branch);
    refs.push('origin/' + branch);
  }
  var fallbacks = ['HEAD', 'main', 'master'];
  for (var i = 0; i < fallbacks.length; i++) {
    if (refs.indexOf(fallbacks[i]) < 0) { refs.push(fallbacks[i]); }
  }
  return refs;
}

// Try multiple git refs for a file, returning content from the first that succeeds.
function resolveGitContentMultiRef(basename, filePathMap, repoRoot, refs) {
  var fullPath = filePathMap[basename];
  if (!fullPath) { return null; }
  var relPath = computeRepoRelativePath(fullPath, repoRoot);
  if (!relPath) { return null; }
  for (var i = 0; i < refs.length; i++) {
    var content = readGitFileContent(repoRoot, refs[i], relPath);
    if (content !== null) { return content; }
  }
  return null;
}

// Try to get the git repo root for a directory. Returns root path or null.
function tryGitRoot(dirPath) {
  try {
    var root = cp.execSync('git -C ' + JSON.stringify(dirPath) + ' rev-parse --show-toplevel', {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return root.trim();
  } catch (e) { return null; }
}

// Walk up from startPath to find the nearest directory that is a git repo.
function resolveRepoRootWalkingUp(startPath) {
  if (!startPath) { return null; }
  var fs = require('fs');
  var current = startPath;
  while (current && current !== '/') {
    if (fs.existsSync(current)) {
      var root = tryGitRoot(current);
      if (root) { return root; }
    }
    var parent = require('path').dirname(current);
    if (parent === current) { break; }
    current = parent;
  }
  return null;
}

// ─── git-rename lineage (from tools/find-jsonls-at-commit.js) ─────────────────

// True when a git --name-status code marks a rename (R) or copy (C).
function isRenameOrCopy(status) {
  if (!status) { return false; }
  if (status.charAt(0) === 'R') { return true; }
  if (status.charAt(0) === 'C') { return true; }
  return false;
}

// True when a status code marks a single-path change (add/modify/delete).
function isSinglePathStatus(status) {
  if (!status) { return false; }
  var c = status.charAt(0);
  if (c === 'A') { return true; }
  if (c === 'M') { return true; }
  if (c === 'D') { return true; }
  return false;
}

// Record a rename/copy line's old+new names into pairs and the names set.
function addRenamePair(fields, pairs, names) {
  if (fields.length < 3) { return; }
  pairs.push({ old: fields[1], new: fields[2] });
  names.add(fields[1]);
  names.add(fields[2]);
}

// Classify one --name-status line, mutating pairs/names accordingly.
function classifyHistoryLine(line, pairs, names) {
  var fields = line.split('\t');
  var status = fields[0];
  if (isRenameOrCopy(status)) { addRenamePair(fields, pairs, names); return; }
  if (fields.length < 2) { return; }
  if (!isSinglePathStatus(status)) { return; }
  names.add(fields[1]);
}

// Parse `git log --follow --name-status` stdout into rename history.
// Returns { pairs:[{old,new}] newest-first, names:Set<repo-relative path> }.
function parseRenameHistory(stdout) {
  var pairs = [];
  var names = new Set();
  var lines = (stdout || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    classifyHistoryLine(lines[i], pairs, names);
  }
  return { pairs: pairs, names: names };
}

// The file's current (newest) name: the most-recent rename target, or — when
// there were no renames — the input path unchanged. History is newest-first.
function pickCurrentPath(hist, inputRelPath) {
  if (hist.pairs.length === 0) { return inputRelPath; }
  return hist.pairs[0].new;
}

// Run `git log --all --follow --name-status` for relPath, returning raw stdout.
// execFileSync (not a shell string) so odd path characters cannot inject.
// Returns '' on any failure (e.g. not a repo) rather than throwing.
function resolveGitFollowHistory(repoRoot, relPath) {
  try {
    return cp.execFileSync(
      'git',
      ['-C', repoRoot, 'log', '--all', '--follow', '--name-status', '--format=%H', '--', relPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (e) {
    return '';
  }
}

// True when absPath currently exists on disk.
function computeOnDisk(absPath) {
  return fs.existsSync(absPath);
}

// ─── git commit timestamp (git-seed beacon, Phase 1) ─────────────────────────

// Raw committer date (strict-ISO `%cI`) of a commit, or '' when the SHA cannot
// be resolved. execFileSync with an argument array (not a shell string) so odd
// SHAs cannot inject — the same invocation pattern resolveGitFollowHistory uses.
// (2-space here matches this file's existing style, which the nesting hook keys on.)
function readCommitterDateRaw(repoRoot, sha) {
  try {
    return cp.execFileSync(
      'git',
      ['-C', repoRoot, 'show', '-s', '--format=%cI', sha],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (e) {
    return '';
  }
}

// The commit's committer timestamp in milliseconds since epoch, or null when
// the SHA cannot be resolved or its date cannot be parsed.
function readGitCommitTimestamp(repoRoot, sha) {
  var raw = readCommitterDateRaw(repoRoot, sha);
  if (!raw) { return null; }
  var ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) { return null; }
  return ms;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeRepoRelativePath: computeRepoRelativePath,
    readGitFileContent: readGitFileContent,
    buildFilePathMap: buildFilePathMap,
    resolveGitContent: resolveGitContent,
    buildGitRefFallbackList: buildGitRefFallbackList,
    resolveGitContentMultiRef: resolveGitContentMultiRef,
    resolveRepoRootWalkingUp: resolveRepoRootWalkingUp,
    isRenameOrCopy: isRenameOrCopy,
    parseRenameHistory: parseRenameHistory,
    pickCurrentPath: pickCurrentPath,
    resolveGitFollowHistory: resolveGitFollowHistory,
    computeOnDisk: computeOnDisk,
    readGitCommitTimestamp: readGitCommitTimestamp
  };
}
