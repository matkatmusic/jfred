// POST /api/layer1-script-run (task 358 part P): one guarded replay with a live NDJSON stream and a cancel.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { WireRunStreamKind, type WireScriptRunRequest } from "../webapp/layer1-wire-script-results.ts";
import { executeRunReplay } from "./layer1_run_replay.ts";
import type { ReplayInput } from "./layer1_run_start_files.ts";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import type { OutputStream } from "./reconstruction_script_sandbox_stream.ts";
import { Uuid, type Path } from "./structures/domain.ts";
import { computeDocumentDecision, type DocumentDecision } from "./viewer_api_consent.ts";
import { assertLocalJsonPost } from "./viewer_api_clear_results.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { sendNdjsonAsync, type NdjsonStep } from "./viewer_api_layer1_route_async.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { sendJson } from "./viewer_server_routes.ts";

interface RouteContext {
  dir: Path;
  repoPath: Path;
  listedFiles: Path[];
}

let isRunLive = false;

function parseRunRequest(body: string): WireScriptRunRequest {
  const parsed = JSON.parse(body) as Partial<WireScriptRunRequest>;
  const isSessionFileText = typeof parsed.sessionFile === "string";
  const isToolUseIdText = typeof parsed.toolUseId === "string";
  const isBodyShaped = isSessionFileText && isToolUseIdText;
  if (!isBodyShaped) {
    throw new Error("body must hold sessionFile and toolUseId as text");
  }
  return { sessionFile: parsed.sessionFile!, toolUseId: parsed.toolUseId!, allowScripts: parsed.allowScripts === true };
}

// Same trust rule as /api/layer1-script-needs: only a transcript the sources list returns.
function findListedSessionFile(sessionFile: string, listedFiles: Path[]): Path {
  for (const listed of listedFiles) {
    const listedText = listed.toString();
    if (listedText === sessionFile) {
      return listed;
    }
  }
  throw new Error(`sessionFile is not one of the listed transcripts: ${sessionFile}`);
}

function buildReplayInput(request: WireScriptRunRequest, context: RouteContext): ReplayInput {
  const sessionFile = findListedSessionFile(request.sessionFile, context.listedFiles);
  const { dir, repoPath, listedFiles } = context;
  return { sessionFile, toolUseId: new Uuid(request.toolUseId), dir, sources: getPathOverrides().sources, repoPath, sessionFiles: listedFiles };
}

function createReplayStep(input: ReplayInput): NdjsonStep {
  return (writeLine, signal) => {
    function writeOutputLine(stream: OutputStream, text: string): void {
      writeLine({ kind: WireRunStreamKind.output, stream, text });
    }
    return executeRunReplay(input, writeLine, writeOutputLine, signal);
  };
}

async function sendReplayStream(response: ServerResponse, input: ReplayInput): Promise<void> {
  isRunLive = true;
  try {
    await sendNdjsonAsync(response, createReplayStep(input));
  }
  finally {
    isRunLive = false;
  }
}

// Without consent the reply is the consent decision and nothing runs.
function readConsentDecision(input: ReplayInput, allowScripts: boolean): DocumentDecision | undefined {
  if (allowScripts) {
    return undefined;
  }
  const { records } = loadTranscript(input.sessionFile.toString(), undefined, true);
  return computeDocumentDecision(records, false);
}

function sendRunReply(response: ServerResponse, input: ReplayInput, decision: DocumentDecision | undefined): void {
  if (decision !== undefined) {
    sendJson(response, 200, decision);
    return;
  }
  if (isRunLive) {
    sendJson(response, 409, { error: "a script run is already live" });
    return;
  }
  void sendReplayStream(response, input);
}

function sendRunForBody(response: ServerResponse, context: RouteContext, body: string): void {
  let input: ReplayInput;
  let decision: DocumentDecision | undefined;
  try {
    const request = parseRunRequest(body);
    input = buildReplayInput(request, context);
    decision = readConsentDecision(input, request.allowScripts);
  }
  catch (error) {
    sendJson(response, 400, { error: String(error) });
    return;
  }
  sendRunReply(response, input, decision);
}

// A bad content type, Host, dir, or repo throws before the body is read: the server answers 400.
export function receiveScriptRun(request: IncomingMessage, response: ServerResponse, url: URL): void {
  assertLocalJsonPost(request);
  const dir = validateExistingFolderParam(url.searchParams, "dir");
  const repoPath = validateExistingFolderParam(url.searchParams, "repo");
  const context = { dir, repoPath, listedFiles: listTranscriptFiles(url.searchParams.getAll("jsonl")) };
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function sendBody(): void {
    sendRunForBody(response, context, body);
  }
  request.on("data", appendChunk);
  request.on("end", sendBody);
}
