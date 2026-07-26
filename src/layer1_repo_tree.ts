// Task 231 (spec S18): the `starting repository state` — every file tracked at a ref, as a
// path RELATIVE to the repo root. Layer 1 reads no JSONL; this is one git plumbing call.
// Posture differs from layered_git_beacons.ts, which swallows git failures: a ref the user
// typed is an input, so a bad one must be a loud error, never a silent fall back to HEAD.

import { spawnSync } from "node:child_process";
import { Path } from "./structures/domain.ts";

// The default ref: HEAD already IS the repo's active branch, so no separate branch lookup. The
// engine's ONE canonical "HEAD" — layered_git_beacons.ts and layer1_commit_history.ts import it
// from here rather than re-spelling the string (coding-requirements §2).
export const ACTIVE_BRANCH_REF = "HEAD";

// Blobs and gitlinks, told apart. `git ls-tree -r` recurses trees but stops at a gitlink,
// so a submodule arrives as ONE mode-160000 entry naming its directory — indistinguishable
// from a blob path once --name-only strips the mode. Both callers need the distinction:
// the pairing must not treat a gitlink as a file, and the disk walk must not descend into
// its folder.
export interface Layer1RepoTree {
    trackedFiles: Path[];
    submodulePaths: Path[];
}

const GITLINK_MODE = "160000";

// One `git ls-tree` record: "<mode> <type> <object>\tpath". The mode is the text before the
// first space, and the path is everything past the first tab — a path may itself contain
// spaces, so the tab is the only safe split point.
function routeTreeRecord(record: string, tree: Layer1RepoTree): void {
    const tabIndex = record.indexOf("\t");
    if (tabIndex === -1) {
        return;
    }
    const path = new Path(record.slice(tabIndex + 1));
    const mode = record.slice(0, record.indexOf(" "));
    if (mode === GITLINK_MODE) {
        tree.submodulePaths.push(path);
        return;
    }
    tree.trackedFiles.push(path);
}

// The tree of `repoDir` at `ref`: tracked file paths and submodule gitlink paths, both relative
// to the repo root, in git's tree order. Throws when the ref does not resolve (or the directory
// is not a repo), naming the ref.
export function readRepoTreeAtRef(repoDir: Path, ref: string = ACTIVE_BRANCH_REF): Layer1RepoTree {
    // -z keeps paths raw (git C-quotes spaces/unicode without it); the argument array means
    // the ref never reaches a shell, so no validation regex or quoting dance is needed. The
    // DEFAULT output format is read rather than --format, which older git versions lack.
    const result = spawnSync("git", ["ls-tree", "-r", "-z", ref, "--"], {
        cwd: repoDir.toString(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`git ls-tree failed for ref "${ref}" in ${repoDir.toString()}: ${result.stderr ?? result.error?.message ?? ""}`.trim());
    }
    const tree: Layer1RepoTree = { trackedFiles: [], submodulePaths: [] };
    for (const record of result.stdout.split("\0")) {
        if (record !== "") {
            routeTreeRecord(record, tree);
        }
    }
    return tree;
}
