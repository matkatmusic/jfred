// GET /api/layer1-session-dots: the dots in [from, to] plus every kept session's span.

import { type ServerResponse } from "node:http";
import { getSessionDotIndex } from "./layer1_session_dots_index.ts";
import { listDotsInRange } from "./layer1_session_dots_query.ts";
import type { Layer1WireSessionDots } from "./layer1_session_dots_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { Path } from "./structures/domain.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

export function buildLayer1SessionDots(projectFolder: Path, files: readonly Path[], range: { from: Date; to: Date }, reportProgress: ProgressSink = () => {}): Layer1WireSessionDots {
  const index = getSessionDotIndex(projectFolder, files, reportProgress);
  return { annotations: listDotsInRange(index.dots, range.from, range.to), sessionSpans: index.sessionSpans };
}

function readInstantParam(query: URLSearchParams, name: string): Date {
  const instant = new Date(getRequiredParam(query, name));
  const isInvalid = Number.isNaN(instant.getTime());
  if (isInvalid) {
    throw new Error(`not an instant: ${name}`);
  }
  return instant;
}

export function sendLayer1SessionDotsResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectFolder = validateExistingFolderParam(query, "dir");
  const folders = query.getAll("jsonl");
  if (folders.length === 0) {
    throw new Error("missing query param: jsonl");
  }
  const range = { from: readInstantParam(query, "from"), to: readInstantParam(query, "to") };
  sendJson(response, 200, buildLayer1SessionDots(projectFolder, listTranscriptFiles(folders), range));
}
