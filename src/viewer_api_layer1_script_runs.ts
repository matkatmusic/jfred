// HTTP surface for GET /api/layer1-script-runs (task l4-wire-real); parses and frames only, layer1_script_runs_wire.ts builds the view.

import { type ServerResponse } from "node:http";
import { buildScriptRunsView } from "./layer1_script_runs_wire.ts";
import { validateExistingFolderParam, sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { sendJson } from "./viewer_server_routes.ts";

// A bad dir throws before any header, so the server's outer catch 400s it.
export function sendLayer1ScriptRunsResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectFolder = validateExistingFolderParam(query, "dir");
  const sessionFiles = listTranscriptFiles(query.getAll("jsonl"));
  const progressParam = query.get("progress");
  if (progressParam !== "1") {
    sendJson(response, 200, buildScriptRunsView(projectFolder, sessionFiles));
    return;
  }
  const buildStreamedView = (writeNdjsonLine: (value: unknown) => void) => buildScriptRunsView(projectFolder, sessionFiles, writeNdjsonLine);
  sendNdjsonBuild(response, buildStreamedView);
}
