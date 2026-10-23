// HTTP surface for GET /api/layer1-branches (task 357); parses and frames only, layer1_branches_wire.ts builds the view.

import { type ServerResponse } from "node:http";
import { buildBranchesView } from "./layer1_branches_wire.ts";
import { requireExistingFolderParam, streamNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { sendJson } from "./viewer_server_routes.ts";

// A bad dir throws before any header, so the server's outer catch 400s it.
export function handleLayer1BranchesRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectFolder = requireExistingFolderParam(query, "dir");
    const sessionFiles = listTranscriptFiles(query.getAll("jsonl"));
    if (query.get("progress") !== "1") {
        sendJson(response, 200, buildBranchesView(projectFolder, sessionFiles));
        return;
    }
    streamNdjsonBuild(response, (writeNdjsonLine) => buildBranchesView(projectFolder, sessionFiles, writeNdjsonLine));
}
