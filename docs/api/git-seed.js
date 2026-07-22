// git-seed: seed an Engine-B line belief from a git commit's file content, then
// keep only the JSONL events that happened strictly AFTER the commit instant.
// A git commit is a known-good baseline: when the JSONL corpus is missing edits,
// seeding belief from the commit and replaying only post-commit events repairs
// the gap. Fully opt-in — callers pass opts.gitSeed; with no seed, nothing here
// runs. New file: 4-space indent throughout.

var lb = require('./line-belief');
var lineStateEvidence = require('./line-state-evidence');
var gitState = require('./git-file-state');

// Overwrite a fresh belief so every line of the commit's file content becomes a
// witnessed (observed) line belief, the file is end-of-file-confirmed, and each
// line carries a git evidence ref. The seed instant (seedMs) is the commit's
// committer time; it also becomes the belief's last beacon.
function seedBeliefFromGitContent(belief, content, seedMs, sha) {
    var lines = lineStateEvidence.splitContentIntoLineSpans(content);
    for (var i = 0; i < lines.length; i++) {
        var lineNum = i + 1;
        var ref = buildGitSeedRef(sha, lineNum);
        belief.entries[lineNum] = lb.makeClaimEntry('observed', seedMs, ref, lines[i]);
    }
    belief.lastLine = lines.length;
    belief.eofConfirmed = true;
    belief.lastBeaconMs = seedMs;
}

// The evidence ref that marks a belief line as proven by a git commit. Mirrors
// the ref convention final-line-verdict reads in mismatch records — a single
// source-discriminated locator, here keyed to a commit SHA and line number.
function buildGitSeedRef(sha, lineNum) {
    return { source: 'git-commit', gitCommit: sha, line: lineNum };
}

// Keep only the events strictly after the seed instant; anything at or before it
// is already baked into the seed, so it must not replay over the baseline.
function filterEventsAfter(events, seedMs) {
    return events.filter(function (e) { return e.unixMs > seedMs; });
}

// The { content, seedMs } seed pair for one file at one commit, or null when
// either the file content or the commit timestamp cannot be resolved. Nested
// single-condition guards (never &&) keep each failure point separately visible.
function resolveSeedFromCommit(repoRoot, sha, relPath) {
    var content = gitState.readGitFileContent(repoRoot, sha, relPath);
    if (!content) { return null; }
    var seedMs = gitState.readGitCommitTimestamp(repoRoot, sha);
    if (seedMs === null) { return null; }
    return { content: content, seedMs: seedMs };
}

module.exports = {
    seedBeliefFromGitContent: seedBeliefFromGitContent,
    buildGitSeedRef: buildGitSeedRef,
    filterEventsAfter: filterEventsAfter,
    resolveSeedFromCommit: resolveSeedFromCommit
};
