// GET /api/layer1-session-dot-instants: every session's dot instants over the whole index.

import { type ServerResponse } from "node:http";
import { getSessionDotIndex } from "./layer1_session_dots_index.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { Path } from "./structures/domain.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { sendJson } from "./viewer_server_routes.ts";
import { encodeSessionDotInstants, type WireSessionDotInstants } from "../webapp/layer1-components/session-column/layer1-wire-session-instants.ts";

export function buildLayer1SessionDotInstants(projectFolder: Path, files: readonly Path[], reportProgress: ProgressSink = () => {}): WireSessionDotInstants {
  const index = getSessionDotIndex(projectFolder, files, reportProgress);
  const instants = new Map<string, number[]>();
  for (const dot of index.dots) {
    const sessionId = dot.sessionId.toString();
    const sessionMs = instants.get(sessionId) ?? [];
    sessionMs.push(dot.instant.getTime());
    instants.set(sessionId, sessionMs);
  }
  return encodeSessionDotInstants(instants);
}

export function sendLayer1SessionDotInstantsResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectFolder = validateExistingFolderParam(query, "dir");
  const folders = query.getAll("jsonl");
  if (folders.length === 0) {
    throw new Error("missing query param: jsonl");
  }
  sendJson(response, 200, buildLayer1SessionDotInstants(projectFolder, listTranscriptFiles(folders)));
}
