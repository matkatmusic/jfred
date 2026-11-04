// POST /api/layer1-script-needs (task 358 part NS): lists the earlier runs a run still needs; runs nothing.

import { type IncomingMessage, type ServerResponse } from "node:http";
import type { WireScriptNeedsReply, WireScriptNeedsRequest } from "../webapp/layer1-wire-script-results.ts";
import { computeRunNeeds } from "./layer1_run_needs.ts";
import type { RunInput } from "./layer1_run_start_files.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import { Uuid, type Path } from "./structures/domain.ts";
import { assertLocalJsonPost } from "./viewer_api_clear_results.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { sendJson } from "./viewer_server_routes.ts";

function parseNeedsRequest(body: string): WireScriptNeedsRequest {
  const parsed = JSON.parse(body) as Partial<WireScriptNeedsRequest>;
  const isSessionFileMissing = typeof parsed.sessionFile !== "string";
  const isToolUseIdMissing = typeof parsed.toolUseId !== "string";
  const isTextMissing = isSessionFileMissing || isToolUseIdMissing;
  if (isTextMissing) {
    throw new Error("body must hold sessionFile and toolUseId as text");
  }
  return { sessionFile: parsed.sessionFile!, toolUseId: parsed.toolUseId! };
}

// Same trust rule as /api/layer1-script-runs: only a transcript the sources list returns.
function findListedSessionFile(sessionFile: string, listedFiles: Path[]): Path {
  for (const listed of listedFiles) {
    const listedText = listed.toString();
    if (listedText === sessionFile) {
      return listed;
    }
  }
  throw new Error(`sessionFile is not one of the listed transcripts: ${sessionFile}`);
}

function buildRunInput(request: WireScriptNeedsRequest, dir: Path, listedFiles: Path[]): RunInput {
  const sessionFile = findListedSessionFile(request.sessionFile, listedFiles);
  return { sessionFile, toolUseId: new Uuid(request.toolUseId), dir, sources: getPathOverrides().sources };
}

function sendNeedsReply(response: ServerResponse, input: RunInput): void {
  let reply: WireScriptNeedsReply;
  try {
    reply = { toolUseId: input.toolUseId.toString(), needs: computeRunNeeds(input) };
  }
  catch (error) {
    sendJson(response, 500, { error: (error as Error).message });
    return;
  }
  sendJson(response, 200, reply);
}

function receiveNeedsBody(response: ServerResponse, dir: Path, listedFiles: Path[], body: string): void {
  let input: RunInput;
  try {
    input = buildRunInput(parseNeedsRequest(body), dir, listedFiles);
  }
  catch (error) {
    sendJson(response, 400, { error: String(error) });
    return;
  }
  sendNeedsReply(response, input);
}

// A bad content type, Host, or dir throws before the body is read: the server answers 400.
export function receiveScriptNeeds(request: IncomingMessage, response: ServerResponse, url: URL): void {
  assertLocalJsonPost(request);
  const dir = validateExistingFolderParam(url.searchParams, "dir");
  const listedFiles = listTranscriptFiles(url.searchParams.getAll("jsonl"));
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function receiveBody(): void {
    receiveNeedsBody(response, dir, listedFiles, body);
  }
  request.on("data", appendChunk);
  request.on("end", receiveBody);
}
