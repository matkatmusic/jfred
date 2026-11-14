// Fills each outside git folder at its Mac path: tracked files from the commit checked out at the event's time, untracked and ignored files linked to today's folder.
// Known limit: `git status` in an outside folder compares against today's index, not the filled commit.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { readHashAtTime } from "./engineV3_replay_git_start.ts";

// The docker script mounts each live outside git folder read-only at this prefix plus its Mac path.
export const OUTSIDE_LIVE_ROOT = "/outside-live";
// git knows the empty tree in every repo; filling it removes every tracked file.
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GITLINK_MODE = "160000";
const GIT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

const filledCommitByFolder = new Map<string, string>();
const indexFileByWorkTree = new Map<string, string>();

function getIndexFileForWorkTree(workTree: string): string {
    const knownIndexFile = indexFileByWorkTree.get(workTree);
    if (knownIndexFile !== undefined) {
        return knownIndexFile;
    }
    const indexFile = join(mkdtempSync(join(tmpdir(), "engine-v3-outside-index-")), "index");
    indexFileByWorkTree.set(workTree, indexFile);
    return indexFile;
}

function executeGitInWorkTree(gitFolder: string, workTree: string, args: string[]): string {
    const env = { ...process.env, GIT_DIR: gitFolder, GIT_WORK_TREE: workTree, GIT_INDEX_FILE: getIndexFileForWorkTree(workTree) };
    return execFileSync("git", args, { env, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER_BYTES });
}

function readCommitAtTime(gitFolder: string, time: Date): string {
    const commit = readHashAtTime(join(gitFolder, "logs", "HEAD"), time);
    if (commit === undefined) {
        return EMPTY_TREE_HASH;
    }
    return commit;
}

// Uses today's index of the live folder, so it lists what is untracked or ignored today.
function listUntrackedEntries(gitFolder: string, liveWorkTree: string): string[] {
    const env = { ...process.env, GIT_DIR: gitFolder, GIT_WORK_TREE: liveWorkTree };
    const output = execFileSync("git", ["ls-files", "--others", "--directory", "-z"], { cwd: liveWorkTree, env, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER_BYTES });
    const entries: string[] = [];
    for (const entry of output.split("\0")) {
        if (entry !== "") {
            entries.push(entry.replace(/\/$/, ""));
        }
    }
    return entries;
}

function isPathMissing(path: string): boolean {
    return lstatSync(path, { throwIfNoEntry: false }) === undefined;
}

// A path that the filled commit tracks keeps the tracked file.
function linkMissingPath(livePath: string, macPath: string): void {
    if (isPathMissing(macPath)) {
        mkdirSync(dirname(macPath), { recursive: true });
        symlinkSync(livePath, macPath);
    }
}

function fillWorkTreeAtCommit(gitFolder: string, liveWorkTree: string, macWorkTree: string, commit: string): void {
    executeGitInWorkTree(gitFolder, macWorkTree, ["read-tree", "--reset", "-u", commit]);
    for (const entry of listUntrackedEntries(gitFolder, liveWorkTree)) {
        linkMissingPath(join(liveWorkTree, entry), join(macWorkTree, entry));
    }
}

function listGitlinks(gitFolder: string, commit: string): { path: string; commit: string }[] {
    const output = execFileSync("git", [`--git-dir=${gitFolder}`, "ls-tree", "-r", "-z", commit], { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER_BYTES });
    const gitlinks: { path: string; commit: string }[] = [];
    for (const row of output.split("\0")) {
        if (row.startsWith(`${GITLINK_MODE} `)) {
            const [header, path] = row.split("\t") as [string, string];
            gitlinks.push({ path, commit: header.split(" ")[2] as string });
        }
    }
    return gitlinks;
}

function fillOneOutsideGitFolder(macFolder: string, liveRoot: string, time: Date): void {
    const liveFolder = liveRoot + macFolder;
    const gitFolder = join(liveFolder, ".git");
    const commit = readCommitAtTime(gitFolder, time);
    if (filledCommitByFolder.get(macFolder) === commit) {
        return;
    }
    fillWorkTreeAtCommit(gitFolder, liveFolder, macFolder, commit);
    // Submodule names equal their paths in the outside repos, so the module repo is .git/modules/<path>.
    for (const gitlink of listGitlinks(gitFolder, commit)) {
        const liveSubmodule = join(liveFolder, gitlink.path);
        const macSubmodule = join(macFolder, gitlink.path);
        fillWorkTreeAtCommit(join(gitFolder, "modules", gitlink.path), liveSubmodule, macSubmodule, gitlink.commit);
        linkMissingPath(join(liveSubmodule, ".git"), join(macSubmodule, ".git"));
    }
    filledCommitByFolder.set(macFolder, commit);
}

export function fillOutsideGitFoldersAtTime(macFolders: Path[], liveRoot: string, time: Date): void {
    for (const macFolder of macFolders) {
        fillOneOutsideGitFolder(macFolder.toString(), liveRoot, time);
    }
}
