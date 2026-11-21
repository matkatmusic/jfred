// The start beacon of a file: the commit that created it, found by walking the history back from the start commit across renames.

import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

import { Path } from "../src/structures/domain.ts";

const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const COMMIT_LINE_PREFIX = "C ";
const ADDED_LINE_PREFIX = "A\t";

export interface FileCreation {
    commit: string;
    pathAtCreation: Path;
}

// undefined: no commit at or before startCommit ever added the file, so it is born after the start.
export function getFileCreationCommit(repo: Path, startCommit: string, file: Path): FileCreation | undefined {
    const relativePath = relative(repo.toString(), file.toString());
    const logText = execFileSync("git", ["-C", repo.toString(), "log", "--follow", "-M", "--diff-filter=A", "--name-status", `--format=${COMMIT_LINE_PREFIX}%H`, startCommit, "--", relativePath], { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER_BYTES });
    let oldestCommit: string | undefined;
    let oldestRelativePath: string | undefined;
    for (const line of logText.split("\n")) {
        if (line.startsWith(COMMIT_LINE_PREFIX)) {
            oldestCommit = line.slice(COMMIT_LINE_PREFIX.length);
        }
        if (line.startsWith(ADDED_LINE_PREFIX)) {
            oldestRelativePath = line.slice(ADDED_LINE_PREFIX.length);
        }
    }
    if (oldestCommit === undefined) {
        return undefined;
    }
    return { commit: oldestCommit, pathAtCreation: new Path(join(repo.toString(), oldestRelativePath!)) };
}
