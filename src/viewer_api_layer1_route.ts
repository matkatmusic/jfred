// HTTP surface for GET /api/layer1-view; parses and frames only, since viewer_api_layer1.ts builds the view without knowing about HTTP.

import { type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { ACTIVE_BRANCH_REF } from "./layer1_repo_tree.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { CommitTimeSource } from "../webapp/layer1-wire.ts";
import { buildLayer1View } from "./viewer_api_layer1.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

// Validated here so a bad folder is a 400, not an ENOENT; no allowlist — the user's own machine.
export function validateExistingFolderParam(query: URLSearchParams, name: string): Path {
  const value = getRequiredParam(query, name);
  const folderExists = existsSync(value);
  if (!folderExists) {
    throw new Error(`${name} folder does not exist: ${value}`);
  }
  const isFolder = statSync(value).isDirectory();
  if (!isFolder) {
    throw new Error(`${name} is not a folder: ${value}`);
  }
  return new Path(value);
}

// Absent or blank ref means the active branch; the ref never reaches a shell, so no regex.
export function getRequestedRef(query: URLSearchParams): string {
  const requested = query.get("ref");
  if (requested === null) {
    return ACTIVE_BRANCH_REF;
  }
  const trimmedRef = requested.trim();
  if (trimmedRef === "") {
    return ACTIVE_BRANCH_REF;
  }
  return trimmedRef;
}

// An unknown time value falls back to committer rather than 400, so a typo doesn't refuse an otherwise-valid view.
function getRequestedTimeSource(query: URLSearchParams): CommitTimeSource {
  return query.get("time") === CommitTimeSource.author ? CommitTimeSource.author : CommitTimeSource.committer;
}

// Same NDJSON framing as /api/document; shared by /api/layer1-view and /api/layer1-sessions (task 304).
export function sendNdjsonBuild(response: ServerResponse, build: (writeNdjsonLine: (value: unknown) => void) => unknown): void {
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.socket?.setNoDelay(true);   // sync build between writes — do not let Nagle batch the lines
  const writeNdjsonLine = (value: unknown): void => {
    // The synchronous build never yields, so client-abort surfaces as the next write failing (EPIPE).
    const socket = response.socket;
    const isResponseDestroyed = response.destroyed;
    const isSocketMissing = socket === null;
    const isSocketDestroyed = socket?.destroyed === true;
    const isSocketUnwritable = socket?.writable !== true;
    const isClientGone = isResponseDestroyed || isSocketMissing || isSocketDestroyed || isSocketUnwritable;
    if (isClientGone) {
      throw new Error("client disconnected — build cancelled");
    }
    response.write(JSON.stringify(value) + "\n");
    // res.write corks the socket, and newer Node corks the response too; both uncork on nextTick, which never fires mid-build.
    if (response.writableCorked > 0) {
      response.uncork();
    }
    response.socket?.uncork();
  };
  try {
    response.end(JSON.stringify(build(writeNdjsonLine)) + "\n");
  }
  catch (error) {
    // Deliberate asymmetry: bad params 400 before any header; a mid-build failure is a terminal error line.
    response.end(JSON.stringify({ kind: DocumentResponseKind.error, label: (error as Error).message }) + "\n");
  }
}

// Both folder checks run first: a bad dir/repo throws before any header, so the outer catch 400s.
export function sendLayer1ViewResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectFolder = validateExistingFolderParam(query, "dir");
  const repoDir = validateExistingFolderParam(query, "repo");
  const ref = getRequestedRef(query);
  const timeSource = getRequestedTimeSource(query);
  // Task 312: the repeatable ?jsonl= /api/layer1-sessions already takes; absent means no snapshots.
  const sessionFiles = listTranscriptFiles(query.getAll("jsonl"));
  const progressParam = query.get("progress");
  if (progressParam !== "1") {
    sendJson(response, 200, buildLayer1View(projectFolder, repoDir, ref, undefined, timeSource, sessionFiles));
    return;
  }
  const buildStreamedView = (writeNdjsonLine: (value: unknown) => void) => buildLayer1View(projectFolder, repoDir, ref, writeNdjsonLine, timeSource, sessionFiles);
  sendNdjsonBuild(response, buildStreamedView);
}
