// Fixture mode: the saved run ids, the needs route, and the clear route for the canned script runs.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import {
  WireNeedState,
  WireRunOutcome,
  type WireNeededRun,
  type WireScriptNeedsReply,
  type WireScriptNeedsRequest,
  type WireScriptResult,
} from "../webapp/layer1-wire-script-results.ts";
import { buildSessionFile, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { findFixtureScriptRun } from "./viewer_api_layer4_fixture_data.ts";
import { FIXTURE_RUN_BLOCKERS, findCannedFixtureRun } from "./viewer_api_layer6_fixture_data.ts";
import { sendJson } from "./viewer_server_routes.ts";

export const savedFixtureRuns = new Set<string>();

const SAVED_CONFIDENCES: WireConfidence[] = [WireConfidence.verified, WireConfidence.mismatch, WireConfidence.injectedUnverified];

export function readFixtureRequestBody(request: IncomingMessage, answerBody: (body: string) => void): void {
  let body = "";
  function appendChunk(chunk: Buffer): void {
    body += chunk.toString();
  }
  function sendBody(): void {
    answerBody(body);
  }
  request.on("data", appendChunk);
  request.on("end", sendBody);
}

export function markFixtureRunSaved(result: WireScriptResult): void {
  const isReplayFailed = result.outcome === WireRunOutcome.replayFailed;
  const hasConfidence = result.confidence !== undefined;
  const isSavedConfidence = hasConfidence && SAVED_CONFIDENCES.includes(result.confidence!);
  const isSaved = isReplayFailed || isSavedConfidence;
  if (isSaved) {
    savedFixtureRuns.add(result.toolUseId);
  }
}

function findFixtureNeedState(blockerId: string): WireNeedState | undefined {
  const isSaved = savedFixtureRuns.has(blockerId);
  if (!isSaved) {
    return WireNeedState.unreplayed;
  }
  const isCrashed = findCannedFixtureRun(blockerId).outcome === WireRunOutcome.replayFailed;
  if (isCrashed) {
    return WireNeedState.replayFailed;
  }
  return undefined;
}

function buildNeededRun(blockerId: string, state: WireNeedState): WireNeededRun {
  const blocker = findFixtureScriptRun(blockerId);
  return {
    toolUseId: blockerId, sessionFile: buildSessionFile(blocker.session).toString(), line: blocker.line,
    instant: new Date(parseMs(blocker.at)).toISOString(), state,
  };
}

export function listFixtureNeeds(toolUseId: string): WireNeededRun[] {
  const needs: WireNeededRun[] = [];
  for (const blockerId of FIXTURE_RUN_BLOCKERS[toolUseId] ?? []) {
    const state = findFixtureNeedState(blockerId);
    if (state !== undefined) {
      needs.push(buildNeededRun(blockerId, state));
    }
  }
  return needs;
}

export function receiveFixtureScriptNeeds(request: IncomingMessage, response: ServerResponse): void {
  function sendNeedsReply(body: string): void {
    const { toolUseId } = JSON.parse(body) as WireScriptNeedsRequest;
    const reply: WireScriptNeedsReply = { toolUseId, needs: listFixtureNeeds(toolUseId) };
    sendJson(response, 200, reply);
  }
  readFixtureRequestBody(request, sendNeedsReply);
}

export function sendFixtureClearResults(response: ServerResponse): void {
  savedFixtureRuns.clear();
  sendJson(response, 200, { cleared: true });
}
