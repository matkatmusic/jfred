// reference-ladder: the CLI's reference source ladder for track-line-states.
// Item 13 adds the git rung between snapshot and none: when the target is off
// disk (deleted/moved) and no snapshot blob exists, but the file still lives in
// git, git becomes a scorable reference. Mirrors the probe's git ladder
// (api/reconstruction-reference-sources.js gatherGitSource) but builds its
// filePathMap from the alias closure rather than per-transcript edits — the
// closure already names every absolute path the file is known by. Pure git/fs
// IO; no console/argv. New file -> 4-space indent throughout.

var path = require('path');
var gitState = require('./git-file-state');
var distinctBasenames = require('./reconstruction-reference-sources').distinctBasenames;
var extractSessionMetadata = require('./transcript-parsers').extractSessionMetadata;

// basename -> absolute path, first-seen wins. The absolute path MUST live inside
// the session repo (computeRepoRelativePath strips the repo root, git-file-state.js:17).
function buildFilePathMapFromPaths(absPaths) {
    var map = {};
    for (var i = 0; i < absPaths.length; i++) {
        var base = path.basename(absPaths[i]);
        if (!map[base]) { map[base] = absPaths[i]; }
    }
    return map;
}

// Try ONE transcript's session git metadata for any of the file's basenames.
// null when the session has no usable git context or no ref holds the file.
function resolveGitFromTranscript(transcriptText, basenames, filePathMap) {
    var meta = extractSessionMetadata(transcriptText);
    if (!meta.gitBranch) { return null; }
    if (!meta.cwd) { return null; }
    var repoRoot = gitState.resolveRepoRootWalkingUp(meta.cwd);
    if (!repoRoot) { return null; }
    var refs = gitState.buildGitRefFallbackList(meta.gitBranch);
    for (var b = 0; b < basenames.length; b++) {
        var content = gitState.resolveGitContentMultiRef(basenames[b], filePathMap, repoRoot, refs);
        if (content !== null) { return content; }
    }
    return null;
}

// The git rung: scan the target's transcripts most-recent-first for session git
// metadata, then try the file's basenames against that session's refs. Returns
// the file content (possibly '') from the first ref that holds it, or null when
// no transcript has git context that resolves the file.
function resolveGitReference(target, aliasPaths, transcriptTexts) {
    var basenames = distinctBasenames(aliasPaths, target);
    var filePathMap = buildFilePathMapFromPaths([target].concat(aliasPaths));
    for (var t = transcriptTexts.length - 1; t >= 0; t--) {
        var content = resolveGitFromTranscript(transcriptTexts[t], basenames, filePathMap);
        if (content !== null) { return content; }
    }
    return null;
}

module.exports = {
    buildFilePathMapFromPaths: buildFilePathMapFromPaths,
    resolveGitFromTranscript: resolveGitFromTranscript,
    resolveGitReference: resolveGitReference
};
