// git-commit-matches: the discovery complement to git-seed. Enumerates every
// committed version of a file (following renames) and builds a PURE matcher that,
// given the engine's live per-line belief, returns the commits whose content the
// belief reproduces exactly. Matching is routed through final-line-verdict's
// buildFinalVerdict so it can never diverge from how the verdict scores a git
// reference: an exact reproduction has zero mismatched AND zero neverObserved lines.
// New file -> 4-space indent.

var gitState = require('./git-file-state');
var buildFinalVerdict = require('./final-line-verdict').buildFinalVerdict;

// ─── Commit enumeration (parse `--follow` log) ───────────────────────────────

// One { sha, path } per commit, newest-first, from
// `git log --all --follow --name-status --format=%H` stdout (resolveGitFollowHistory).
// A sha line has no tab and is 7-40 hex chars; a name-status line contains a tab.
function parseCommitHashAndPathFromFollowLog(stdout) {
    var commits = [];
    var lines = (stdout || '').split('\n');
    var current = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line === '') { continue; }
        if (line.indexOf('\t') >= 0) {
            if (current === null) { continue; }
            if (current.path !== null) { continue; }
            current.path = extractPathFromNameStatusLine(line);
            continue;
        }
        if (!/^[0-9a-f]{7,40}$/.test(line)) { continue; }
        current = { sha: line, path: null };
        commits.push(current);
    }
    return commits.filter(function (commit) { return commit.path !== null; });
}

// The repo-relative path a --name-status line points at: rename/copy TARGET (third
// field) for R/C, else the single changed path (second field). Reuses isRenameOrCopy.
function extractPathFromNameStatusLine(line) {
    var fields = line.split('\t');
    if (gitState.isRenameOrCopy(fields[0])) {
        if (fields.length >= 3) { return fields[2]; }
        return null;
    }
    if (fields.length >= 2) { return fields[1]; }
    return null;
}

// ─── The pure matcher ────────────────────────────────────────────────────────

// Build a matcher over precomputed committed versions. The returned function takes the
// engine's live per-line belief and returns the { sha, shortSha, path } descriptors of
// every version the belief reproduces exactly; [] when the belief is not a confident
// complete state or matches none. No git IO — only the precomputed contents.
function buildCommittedVersionMatcher(committedVersions) {
    return function (belief) {
        if (!belief.eofConfirmed) { return []; }
        var matches = [];
        for (var i = 0; i < committedVersions.length; i++) {
            var version = committedVersions[i];
            if (!beliefReproducesContent(belief, version.content)) { continue; }
            matches.push({ sha: version.sha, shortSha: version.shortSha, path: version.path });
        }
        return matches;
    };
}

// True when the belief's per-line text equals `content` on every line with no missing or
// extra lines. Reuses buildFinalVerdict (the same per-line compare the final verdict runs
// for the git reference) so matching can never diverge from scoring: an exact reproduction
// has zero mismatched AND zero neverObserved lines.
function beliefReproducesContent(belief, content) {
    var verdict = buildFinalVerdict(belief, { via: 'git-commit', content: content });
    if (verdict.perLineStats.mismatched > 0) { return false; }
    if (verdict.perLineStats.neverObserved > 0) { return false; }
    return true;
}

// ─── Commit content enumeration (git IO) ─────────────────────────────────────

// Every committed version of the file at relPath (following renames), newest-first:
// [{ sha, shortSha, path, content }]. Drops any commit whose content can't be read.
function collectCommittedFileVersions(repoRoot, relPath) {
    var stdout = gitState.resolveGitFollowHistory(repoRoot, relPath);
    var commitsWithPaths = parseCommitHashAndPathFromFollowLog(stdout);
    var versions = [];
    for (var i = 0; i < commitsWithPaths.length; i++) {
        var commit = commitsWithPaths[i];
        var content = gitState.readGitFileContent(repoRoot, commit.sha, commit.path);
        if (content === null) { continue; }
        versions.push({ sha: commit.sha, shortSha: commit.sha.slice(0, 7), path: commit.path, content: content });
    }
    return versions;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseCommitHashAndPathFromFollowLog: parseCommitHashAndPathFromFollowLog,
        collectCommittedFileVersions: collectCommittedFileVersions,
        buildCommittedVersionMatcher: buildCommittedVersionMatcher
    };
}
