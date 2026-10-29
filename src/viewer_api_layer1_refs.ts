// GET /api/layer1-refs (task 286): branches, head and a commit window for Layer 1's header dropdowns.

import { spawnSync } from "node:child_process";
import { type ServerResponse } from "node:http";
import { Path } from "./structures/domain.ts";
import { validateExistingFolderParam, getRequestedRef } from "./viewer_api_layer1_route.ts";
import { parseGitLogOutput } from "./viewer_api_repo_commits.ts";
import type { Layer1RefsView } from "../webapp/layer1-wire.ts";
import { sendJson } from "./viewer_server_routes.ts";

// User-locked at 200 (2026-07-27): the dropdown is a head window, not a history browser.
export const LAYER1_REF_COMMIT_LIMIT = 200;

// Git runs in argument-array form (task 235) so a URL `ref` never reaches a shell.
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
  const lines: string[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    const isBlank = line === "";
    if (isBlank) {
      continue;
    }
    lines.push(line);
  }
  return lines;
}

// The checked-out branch leads the list; a detached HEAD leaves the order alone.
function sortBranchesHeadFirst(branches: string[], head: string): string[] {
  const hasHead = branches.includes(head);
  if (!hasHead) {
    return branches;
  }
  const others: string[] = [];
  for (const branch of branches) {
    const isOther = branch !== head;
    if (isOther) {
      others.push(branch);
    }
  }
  return [head, ...others];
}

export function buildLayer1RefsView(repoDir: Path, ref: string): Layer1RefsView {
  // A non-zero status here is the repo confirmation; the page hides the pickers when this fails.
  const branches = splitNonEmptyLines(
    readGitOutput(repoDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      `not a git repository: ${repoDir.toString()}`));
  const head = splitNonEmptyLines(
    readGitOutput(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"],
      `not a git repository: ${repoDir.toString()}`))[0] ?? "";
  const commits = parseGitLogOutput(
    readGitOutput(repoDir, ["log", ref, "--format=%H%x09%ad%x09%s", "--date=short", "-n", String(LAYER1_REF_COMMIT_LIMIT)],
      `git log failed for ref "${ref}" in ${repoDir.toString()}`));
  return { branches: sortBranchesHeadFirst(branches, head), head, commits };
}

// `repo` gets the view route's folder check, so a mistyped path is a displayable 400.
export function sendLayer1RefsResponse(response: ServerResponse, query: URLSearchParams): void {
  const repoDir = validateExistingFolderParam(query, "repo");
  sendJson(response, 200, buildLayer1RefsView(repoDir, getRequestedRef(query)));
}
