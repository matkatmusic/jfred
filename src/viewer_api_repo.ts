// The task-137 repo/commit-picker server surface: list a repo's commits for the Paths popover's visual pick list, count how many recorded file paths resolve inside a candidate commit's tree (the soft mismatch warning), and read/apply/store one project's path entry.  HTTP wiring stays in viewer_server.ts; this file parses, dispatches, and serializes.

import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { relative, resolve } from "node:path";
import { findFirstRecordCwd } from "./reconstruction_base_commit.ts";
import { listEventPaths } from "./reconstruction_bound.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import {
    writeProjectPathsEntry,
    type WireProjectPaths,
} from "./reconstruction_overrides.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { type TranscriptRecord } from "./structures/envelope.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import {
    getMergedProjectPaths,
    getProjectsDir,
    setSessionProjectPaths,
} from "./viewer_api_projects.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";
import { resolveJsonlPaths } from "./viewer_api_sources.ts";

// One commit row on the wire, as the pick list renders it.
export type RepoCommitRow = { hash: string; date: string; subject: string };

// git log lines are <hash>\t<date>\t<subject>; the subject may contain further tabs.
export function parseGitLogOutput(output: string): RepoCommitRow[] {
    const rows: RepoCommitRow[] = [];
    for (const line of output.split("\n")) {
        if (line === "") {
            continue;
        }
        const [hash, date, ...subjectParts] = line.split("\t");
        rows.push({ hash: hash!, date: date!, subject: subjectParts.join("\t") });
    }
    return rows;
}

// The repo's commits, newest first (git log order).
// ponytail: 500 newest commits; paginate if a picker ever needs more.
export function listRepoCommits(repoDir: Path): RepoCommitRow[] {
    const output = execSync("git log --format=%H%x09%ad%x09%s --date=short -n 500", {
        cwd: repoDir.toString(),
        stdio: "pipe",
    }).toString();
    return parseGitLogOutput(output);
}

// The soft-warning math: how many recorded relative paths exist in the commit's tree.
export function countPathsInTree(relativePaths: string[], treePaths: Set<string>): { matchedCount: number; totalCount: number } {
    const matchedCount = relativePaths.filter((relativePath) => treePaths.has(relativePath)).length;
    return { matchedCount, totalCount: relativePaths.length };
}

// The recorded targets that live under the recorded project root, as repo-relative paths — the relative-path agreement the engine's cwd remap relies on (readCommitFileContent keys commit-content lookups by relativePath).
function computeRecordedRelativePaths(records: TranscriptRecord[]): string[] {
    const recordedRoot = findFirstRecordCwd(records);
    if (recordedRoot === undefined) {
        return [];
    }
    const uniqueTargets = new Set(extractFileEvents(records).flatMap(listEventPaths).map((eventPath) => eventPath.toString()));
    const relativePaths: string[] = [];
    for (const target of uniqueTargets) {
        const relativePath = relative(recordedRoot.toString(), target);
        if (relativePath === "") {
            continue;
        }
        if (relativePath.startsWith("..")) {
            continue;
        }
        relativePaths.push(relativePath);
    }
    return relativePaths;
}

// The match counts for one candidate commit: recorded relative paths vs the commit's tree.
export function computeCommitPathMatch(records: TranscriptRecord[], repoDir: Path, commit: Uuid): { matchedCount: number; totalCount: number } {
    const treeOutput = execSync(`git ls-tree -r --name-only ${commit.toString()}`, {
        cwd: repoDir.toString(),
        stdio: "pipe",
    }).toString();
    const treePaths = new Set(treeOutput.split("\n").filter((line) => line !== ""));
    return countPathsInTree(computeRecordedRelativePaths(records), treePaths);
}

// The repo query param, resolved against the server's cwd (the jfred root) so both absolute paths (the native picker) and jfred-root-relative paths (existing reveng-paths.json entries, the task-56 convention) work. A non-directory is a loud 400 at the call site.
function resolveRepoParam(query: URLSearchParams): Path {
    const requested = resolve(requireParam(query, "repo"));
    if (!statSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`not a directory: ${requested}`);
    }
    return new Path(requested);
}

// A commit id reaches a shell command — hex-only, 4..40 chars (trust boundary).
const COMMIT_HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/;

function requireCommitParam(query: URLSearchParams): Uuid {
    const commit = requireParam(query, "commit");
    if (!COMMIT_HASH_PATTERN.test(commit)) {
        throw new Error(`not a commit hash: ${commit}`);
    }
    return new Uuid(commit);
}

// GET /api/repo-commits?repo=… — the pick list's rows.
export function handleRepoCommitsRequest(response: ServerResponse, query: URLSearchParams): void {
    sendJson(response, 200, listRepoCommits(resolveRepoParam(query)));
}

// GET /api/repo-commit-match?project=…&repo=…&commit=… — the soft-warning counts.
export function handleRepoCommitMatchRequest(response: ServerResponse, query: URLSearchParams): void {
    const repoDir = resolveRepoParam(query);
    const commit = requireCommitParam(query);
    const jsonlPaths = resolveJsonlPaths(requireParam(query, "project"), null);
    const { records } = loadProjectRecords(jsonlPaths);
    sendJson(response, 200, computeCommitPathMatch(records, repoDir, commit));
}

// The POST /api/project-paths body: the full entry to apply, and whether to also store it.
type WireProjectPathsUpdate = { project: string; entry: WireProjectPaths; persist: boolean };

// Apply one posted update: session always; reveng-paths.json only on persist (the opt-in step — no silent writes). Answers the merged entry.
function applyProjectPathsUpdate(response: ServerResponse, body: string): void {
    const update = JSON.parse(body) as WireProjectPathsUpdate;
    setSessionProjectPaths(update.project, update.entry);
    if (update.persist) {
        writeProjectPathsEntry(getProjectsDir(), update.project, update.entry);
    }
    sendJson(response, 200, getMergedProjectPaths(update.project));
}

// GET: the project's merged entry (stored config + session overrides). POST: apply the posted entry (the handleConfigUpdate body-accumulation pattern).
export function handleProjectPathsRequest(request: IncomingMessage, response: ServerResponse, query: URLSearchParams): void {
    if (request.method !== "POST") {
        sendJson(response, 200, getMergedProjectPaths(requireParam(query, "project")));
        return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
        try {
            applyProjectPathsUpdate(response, body);
        } catch (error) {
            sendJson(response, 400, { error: String(error) });
        }
    });
}
