// git-tree-files: enumerate every file present in a repo at a given commit.
// Thin wrapper over `git ls-tree -r --name-only <sha>`. Returns the committed
// files as repo-relative paths. An unknown/unresolvable SHA (or any git error)
// yields an empty array rather than throwing, so callers can treat "no tree"
// and "empty tree" uniformly.

var cp = require('child_process');

// List every file in repoRoot's tree at commit sha, as repo-relative paths.
// `-r` recurses into subtrees; `--name-only` prints just the paths. On any
// non-zero git exit (bad SHA, not a repo) execFileSync throws and we return [].
function listFilesAtCommit(repoRoot, sha) {
    var stdout;
    try {
        stdout = cp.execFileSync('git', ['-C', repoRoot, 'ls-tree', '-r', '--name-only', sha], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        return [];
    }
    var lines = stdout.split('\n');
    var files = [];
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].length === 0) { continue; }
        files.push(lines[i]);
    }
    return files;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        listFilesAtCommit: listFilesAtCommit
    };
}
