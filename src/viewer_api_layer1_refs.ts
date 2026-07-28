// GET /api/layer1-refs?repo=&ref= — the branch names, the checked-out branch and a head window of commits that fill Layer 1's two header dropdowns (task 286).
//
// Its own module rather than an addition to viewer_api_repo.ts: that file is the classic app's task-137 picker surface and already carries a 500-commit `git log`, tree-match counting and project-paths writing. This route must stay fast, and it is Layer 1's alone. The row shape and the log parser ARE reused from there (no-forwarding-layers: imported, not re-declared), because `git log --format=%H%x09%ad%x09%s` is the exact shape both need.

import { spawnSync } from "node:child_process";
import { type ServerResponse } from "node:http";
import { Path } from "./structures/domain.ts";
import { requireExistingFolderParam, resolveRequestedRef } from "./viewer_api_layer1_route.ts";
import { parseGitLogOutput, type RepoCommitRow } from "./viewer_api_repo.ts";
import { sendJson } from "./viewer_server_routes.ts";

// User-locked at 200 (2026-07-27): the dropdown is a head window, not a history browser.
export const LAYER1_REF_COMMIT_LIMIT = 200;

export interface Layer1RefsView {
    branches: string[];        // local branch names, the checked-out one first
    head: string;              // the branch name the repo is currently on
    commits: RepoCommitRow[];  // newest first, capped at LAYER1_REF_COMMIT_LIMIT
}

// Every git call here is spawnSync in ARGUMENT-ARRAY form (task 235): `ref` arrives from a URL, so it must never reach a shell. `failure` is the caller's message because the two failures mean different things to the page — see the two call sites.
function readGitOutput(repoDir: Path, args: string[], failure: string): string {
    const result = spawnSync("git", args, {
        cwd: repoDir.toString(),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(failure);
    }
    return result.stdout;
}

function splitNonEmptyLines(output: string): string[] {
    return output.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

// The checked-out branch leads the list so the dropdown's first option is the one already in force.  A detached HEAD (rev-parse answers "HEAD", which is no branch) simply leaves the order alone.
function orderBranchesHeadFirst(branches: string[], head: string): string[] {
    if (!branches.includes(head)) {
        return branches;
    }
    return [head, ...branches.filter((branch) => branch !== head)];
}

export function buildLayer1RefsView(repoDir: Path, ref: string): Layer1RefsView {
    // A non-zero status HERE is the repo confirmation the dropdowns gate on: the page hides the pickers when this route fails, so no separate "is this a repo" endpoint exists.
    const branches = splitNonEmptyLines(
        readGitOutput(repoDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
            `not a git repository: ${repoDir.toString()}`));
    const head = splitNonEmptyLines(
        readGitOutput(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"],
            `not a git repository: ${repoDir.toString()}`))[0] ?? "";
    const commits = parseGitLogOutput(
        readGitOutput(repoDir, ["log", ref, "--format=%H%x09%ad%x09%s", "--date=short", "-n", String(LAYER1_REF_COMMIT_LIMIT)],
            `git log failed for ref "${ref}" in ${repoDir.toString()}`));
    return { branches: orderBranchesHeadFirst(branches, head), head, commits };
}

// `repo` gets the same existence + is-a-folder check the view route gives it, so a mistyped path is a 400 the page can display rather than an ENOENT from git's cwd.
export function handleLayer1RefsRequest(response: ServerResponse, query: URLSearchParams): void {
    const repoDir = requireExistingFolderParam(query, "repo");
    sendJson(response, 200, buildLayer1RefsView(repoDir, resolveRequestedRef(query)));
}
