// The git beacons of a file: every commit that touches it, from its creation to the repo HEAD, across renames.

import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

import { Path } from "../src/structures/domain.ts";

const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const COMMIT_LINE_PREFIX = "C ";
const DELETE_STATUS = "D";

export interface FileGitHop {
    commit: string;
    pathAtCommit: Path;
    isDelete: boolean;
}

// Oldest first. pathAtCommit is the path after the commit (the new path for a rename). A merge commit that shows no change to the file is not listed.
export function listGitHopsForFile(repo: Path, file: Path): FileGitHop[] {
    const relativePath = relative(repo.toString(), file.toString());
    const logText = execFileSync("git", ["-C", repo.toString(), "log", "--follow", "-M", "--name-status", `--format=${COMMIT_LINE_PREFIX}%H`, "HEAD", "--", relativePath], { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER_BYTES });
    const hopsNewestFirst: FileGitHop[] = [];
    let commit: string | undefined;
    for (const line of logText.split("\n")) {
        if (line.startsWith(COMMIT_LINE_PREFIX)) {
            commit = line.slice(COMMIT_LINE_PREFIX.length);
        } else if (line !== "") {
            const statusFields = line.split("\t");
            const status = statusFields[0]!;
            const pathAfterCommit = statusFields[statusFields.length - 1]!;
            hopsNewestFirst.push({ commit: commit!, pathAtCommit: new Path(join(repo.toString(), pathAfterCommit)), isDelete: status === DELETE_STATUS });
        }
    }
    return hopsNewestFirst.reverse();
}
