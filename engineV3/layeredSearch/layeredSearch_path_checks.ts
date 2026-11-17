// Path checks of the layered search: is a path in a folder, in a worktree, or in a session scratchpad.

import { execFileSync } from "node:child_process";
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
