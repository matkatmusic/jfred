// Path checks of the layered search: is a path in a folder, in a worktree, or in a session scratchpad.

import { execFileSync, spawnSync } from "node:child_process";
import { isAbsolute, relative, sep } from "node:path";
import { Path } from "../../src/structures/domain.ts";

export function isPathInsideFolder(path: Path, folder: Path): boolean {
    const relativePath = relative(folder.toString(), path.toString());
    if (relativePath === "") {
        return true;
    }
    if (isAbsolute(relativePath)) {
        return false;
    }
    return relativePath.split(sep)[0] !== "..";
}

export function isPathInsideAnyFolder(path: Path, folders: Path[]): boolean {
    for (const folder of folders) {
        if (isPathInsideFolder(path, folder)) {
            return true;
        }
    }
    return false;
}

export function isPathInSessionScratchpad(path: Path, sessionId: string): boolean {
    return new RegExp(`^(/private)?/tmp/claude-[0-9]+/[^/]+/${sessionId}/scratchpad(/|$)`).test(path.toString());
}

// A worktree is merged when its HEAD commit is already in the HEAD of the repo. A squash-merged branch counts as not merged.
export function listMergedWorktreeFolders(repoFolder: Path): Path[] {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoFolder.toString(), encoding: "utf8" });
    const mergedFolders: Path[] = [];
    let worktreeFolderText = "";
    for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
            worktreeFolderText = line.slice("worktree ".length);
        }
        if (line.startsWith("HEAD ")) {
            const result = spawnSync("git", ["merge-base", "--is-ancestor", line.slice("HEAD ".length), "HEAD"], { cwd: repoFolder.toString(), encoding: "utf8" });
            // Exit 1 means not an ancestor; any other non-zero exit is a real failure.
            if (result.status === 0) {
                mergedFolders.push(new Path(worktreeFolderText));
            }
            if (result.status !== 0) {
                if (result.status !== 1) {
                    throw new Error(`git merge-base failed with exit code ${result.status}: ${result.stderr}`);
                }
            }
        }
    }
    return mergedFolders;
}

export function listRepoWorktreeFolders(repoFolder: Path): Path[] {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoFolder.toString(), encoding: "utf8" });
    const worktreeFolders: Path[] = [];
    for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
            worktreeFolders.push(new Path(line.slice("worktree ".length)));
        }
    }
    return worktreeFolders;
}
