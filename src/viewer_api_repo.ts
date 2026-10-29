// The repo/commit-picker routes: commit list and soft-warning match counts.

import { statSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { listRepoCommits } from "./viewer_api_repo_commits.ts";
import { computeCommitPathMatch } from "./viewer_api_repo_match.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";
import { findJsonlPaths } from "./viewer_api_sources.ts";

// The repo query param, resolved against the server cwd; a non-directory throws.
function getRepoParam(query: URLSearchParams): Path {
  const requested = resolve(getRequiredParam(query, "repo"));
  const requestedStat = statSync(requested, { throwIfNoEntry: false });
  const isDirectory = requestedStat?.isDirectory() === true;
  if (!isDirectory) {
    throw new Error(`not a directory: ${requested}`);
  }
  return new Path(requested);
}

// A commit id reaches a shell command: hex only, 4 to 40 chars.
const COMMIT_HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/;

function getCommitParam(query: URLSearchParams): Uuid {
  const commit = getRequiredParam(query, "commit");
  const isCommitHash = COMMIT_HASH_PATTERN.test(commit);
  if (!isCommitHash) {
    throw new Error(`not a commit hash: ${commit}`);
  }
  return new Uuid(commit);
}

// GET /api/repo-commits?repo=... answers the pick list's rows.
export function sendRepoCommitsResponse(response: ServerResponse, query: URLSearchParams): void {
  sendJson(response, 200, listRepoCommits(getRepoParam(query)));
}

// GET /api/repo-commit-match?project=...&repo=...&commit=... answers the soft-warning counts.
export function sendRepoCommitMatchResponse(response: ServerResponse, query: URLSearchParams): void {
  const repoDir = getRepoParam(query);
  const commit = getCommitParam(query);
  const jsonlPaths = findJsonlPaths(getRequiredParam(query, "project"), null);
  const { records } = loadProjectRecords(jsonlPaths);
  sendJson(response, 200, computeCommitPathMatch(records, repoDir, commit));
}
