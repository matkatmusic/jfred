// Reads and applies one project's path entry over HTTP.

import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  writeProjectPathsEntry,
  type WireProjectPaths,
} from "./reconstruction_overrides.ts";
import {
  getMergedProjectPaths,
  getProjectsDir,
  setSessionProjectPaths,
} from "./viewer_api_projects.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

// The POST /api/project-paths body: the full entry to apply, and whether to also store it.
type WireProjectPathsUpdate = { project: string; entry: WireProjectPaths; persist: boolean };

// Apply one posted update: session always; reveng-paths.json only on persist.
function applyProjectPathsUpdate(response: ServerResponse, body: string): void {
  const update = JSON.parse(body) as WireProjectPathsUpdate;
  setSessionProjectPaths(update.project, update.entry);
  if (update.persist) {
    writeProjectPathsEntry(getProjectsDir(), update.project, update.entry);
  }
  sendJson(response, 200, getMergedProjectPaths(update.project));
}

// GET: the project's merged entry. POST: apply the posted entry.
export function dispatchProjectPathsRequest(request: IncomingMessage, response: ServerResponse, query: URLSearchParams): void {
  if (request.method !== "POST") {
    sendJson(response, 200, getMergedProjectPaths(getRequiredParam(query, "project")));
    return;
  }
  let body = "";
  function appendBodyChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function applyBodyOrSendError(): void {
    try {
      applyProjectPathsUpdate(response, body);
    }
    catch (error) {
      sendJson(response, 400, { error: String(error) });
    }
  }
  request.on("data", appendBodyChunk);
  request.on("end", applyBodyOrSendError);
}
