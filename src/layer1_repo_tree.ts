// Bad ref must throw loudly — user-supplied input, not a silent HEAD fallback.

import { spawnSync } from "node:child_process";
import { Path } from "./structures/domain.ts";

// Canonical HEAD constant shared by layered_git_beacons and layer1_commit_history.
export const ACTIVE_BRANCH_REF = "HEAD";

// Separates blobs from gitlinks so callers skip submodule directories.
export interface Layer1RepoTree {
    trackedFiles: Path[];
    submodulePaths: Path[];
}

const GITLINK_MODE = "160000";

// Split on tab, not space — paths may contain spaces.
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

// Throws on bad ref; paths are repo-root-relative.
export function readRepoTreeAtRef(repoDir: Path, ref: string = ACTIVE_BRANCH_REF): Layer1RepoTree {
    // -z avoids C-quoting; array args bypass shell so no ref escaping needed.
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

