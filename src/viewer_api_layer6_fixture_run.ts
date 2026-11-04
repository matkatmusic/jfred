// Fixture mode: POST /api/layer1-script-run answers canned results and streams canned output lines.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as waitMs } from "node:timers/promises";
import { WireRunStreamKind, type WireScriptResult, type WireScriptRunRequest } from "../webapp/layer1-wire-script-results.ts";
import { EarlierRunNotSavedError } from "./reconstruction_script_sandbox_spawn_guard.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { findFixtureScriptRun } from "./viewer_api_layer4_fixture_data.ts";
import { findCannedFixtureRun, type CannedFixtureRun } from "./viewer_api_layer6_fixture_data.ts";
import { listFixtureNeeds, markFixtureRunSaved, readFixtureRequestBody } from "./viewer_api_layer6_fixture_needs.ts";

function writeRunLine(response: ServerResponse, value: unknown): void {
  response.write(`${JSON.stringify(value)}\n`);
}

function joinCannedStream(canned: CannedFixtureRun, stream: "stdout" | "stderr"): string {
  const texts: string[] = [];
  for (const line of canned.lines) {
    if (line.stream === stream) {
      texts.push(line.text);
    }
  }
  return texts.join("\n");
}

function listResultFiles(toolUseId: string, canned: CannedFixtureRun): WireScriptResult["files"] {
  const files: WireScriptResult["files"] = [];
  if (canned.confidence !== undefined) {
    for (const path of findFixtureScriptRun(toolUseId).paths) {
      files.push({ path, confidence: canned.confidence });
    }
  }
  return files;
}

export function buildFixtureRunResult(toolUseId: string, canned: CannedFixtureRun): WireScriptResult {
  return {
    kind: WireRunStreamKind.result, toolUseId, outcome: canned.outcome, files: listResultFiles(toolUseId, canned),
    ...(canned.reason === undefined ? {} : { reason: canned.reason }),
    ...(canned.confidence === undefined ? {} : { confidence: canned.confidence }),
    ...(canned.exitCode === undefined ? {} : { exitCode: canned.exitCode }),
    stdout: joinCannedStream(canned, "stdout"), stderr: joinCannedStream(canned, "stderr"), timedOut: false, isOutputSaved: true,
  };
}

function attachCloseWatch(response: ServerResponse): () => boolean {
  let isClosed = false;
  function markClosed(): void {
    isClosed = true;
  }
  function isResponseClosed(): boolean {
    return isClosed;
  }
  response.on("close", markClosed);
  return isResponseClosed;
}

async function sendCannedOutput(canned: CannedFixtureRun, response: ServerResponse, isResponseClosed: () => boolean): Promise<void> {
  for (const line of canned.lines) {
    const isClosed = isResponseClosed();
    if (isClosed) {
      return;
    }
    // writeRunLine(response, { kind: WireRunStreamKind.output, ...line });
    writeRunLine(response, { kind: WireRunStreamKind.output, ...line, text: `${line.text}\n` });
    await waitMs(canned.lineDelayMs);
  }
}

// A client that closes the response stops the stream before the result is saved.
async function sendCannedRun(toolUseId: string, response: ServerResponse): Promise<void> {
  const canned = findCannedFixtureRun(toolUseId);
  const isResponseClosed = attachCloseWatch(response);
  await sendCannedOutput(canned, response, isResponseClosed);
  const isClosed = isResponseClosed();
  if (isClosed) {
    return;
  }
  const result = buildFixtureRunResult(toolUseId, canned);
  markFixtureRunSaved(result);
  writeRunLine(response, result);
  response.end();
}

function findRunRefusal(run: WireScriptRunRequest): Record<string, string> | undefined {
  if (!run.allowScripts) {
    return { kind: DocumentResponseKind.consentRequired };
  }
  const needs = listFixtureNeeds(run.toolUseId);
  if (needs.length > 0) {
    return { kind: DocumentResponseKind.error, label: new EarlierRunNotSavedError("").message };
  }
  return undefined;
}

export async function sendFixtureRun(run: WireScriptRunRequest, response: ServerResponse): Promise<void> {
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  const refusal = findRunRefusal(run);
  if (refusal !== undefined) {
    writeRunLine(response, refusal);
    response.end();
    return;
  }
  await sendCannedRun(run.toolUseId, response);
}

export function receiveFixtureScriptRun(request: IncomingMessage, response: ServerResponse): void {
  function sendRunBody(body: string): void {
    void sendFixtureRun(JSON.parse(body) as WireScriptRunRequest, response);
  }
  readFixtureRequestBody(request, sendRunBody);
}
