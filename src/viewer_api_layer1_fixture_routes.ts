// Fixture-mode route table and canned senders, split from viewer_api_layer1_fixture.ts.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Layer1RefsView, type RepoCommitRow, SourceKind } from "../webapp/layer1-wire.ts";
import { sendFixtureDiff, sendFixtureFile, sendFixtureRecord } from "./viewer_api_layer1_fixture_file.ts";
import { buildFixtureLayer1View } from "./viewer_api_layer1_fixture_view.ts";
import { BRANCHES, COMMITS, SESSIONS, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import type { FixtureCommit } from "./viewer_api_layer1_fixture_data.ts";
import { buildFixtureSessionsPayload } from "./viewer_api_layer1_fixture_sessions.ts";
import { buildFixtureSettings } from "./viewer_api_layer1_fixture_settings.ts";
import { SNAPSHOTS } from "./viewer_api_layer2_fixture_data.ts";
import { buildFixtureEditsPayload } from "./viewer_api_layer3_fixture_replay.ts";
import { buildFixtureScriptRunsPayload } from "./viewer_api_layer4_fixture_payload.ts";
import { buildFixtureBranchesPayload } from "./viewer_api_layer5_mockup_branches.ts";
import { receiveFixtureScriptRun } from "./viewer_api_layer6_fixture_run.ts";
import { receiveFixtureScriptNeeds, sendFixtureClearResults } from "./viewer_api_layer6_fixture_needs.ts";
import { receiveFixtureJfredCommit } from "./viewer_api_layer9_fixture_commit.ts";
import { buildFixtureEngineV3Steps } from "./viewer_api_engine_v3_fixture_data.ts";
import { sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

type FixtureRouteHandler = (request: IncomingMessage, response: ServerResponse, query: URLSearchParams) => void;

function sendFixtureView(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureLayer1View());
    return;
  }
  sendNdjsonBuild(response, buildFixtureLayer1View);
}

function compareCommitsNewestFirst(left: FixtureCommit, right: FixtureCommit): number {
  return parseMs(right.at) - parseMs(left.at);
}

function sendFixtureRefs(response: ServerResponse): void {
  const commits: RepoCommitRow[] = [];
  for (const commit of [...COMMITS].sort(compareCommitsNewestFirst)) {
    commits.push({ hash: commit.hash, date: commit.at.slice(0, 10), subject: commit.subject });
  }
  const refs: Layer1RefsView = { branches: BRANCHES, head: BRANCHES[0]!, commits };
  sendJson(response, 200, refs);
}

function sendFixtureSessions(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureSessionsPayload());
    return;
  }
  sendNdjsonBuild(response, buildFixtureSessionsPayload);
}

function blockFixtureProgress(): void {
}

function sendFixtureEdits(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureEditsPayload(blockFixtureProgress));
    return;
  }
  sendNdjsonBuild(response, buildFixtureEditsPayload);
}

function sendFixtureScriptRuns(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureScriptRunsPayload(blockFixtureProgress));
    return;
  }
  sendNdjsonBuild(response, buildFixtureScriptRunsPayload);
}

function sendFixtureBranches(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureBranchesPayload(blockFixtureProgress));
    return;
  }
  sendNdjsonBuild(response, buildFixtureBranchesPayload);
}

function sendFixtureScanSource(response: ServerResponse, query: URLSearchParams): void {
  const kind = getRequiredParam(query, "kind");
  const found = kind === SourceKind.jsonl ? SESSIONS.length : SNAPSHOTS.length;
  sendJson(response, 200, { found });
}

export const FIXTURE_ROUTES = new Map<string, FixtureRouteHandler>([
  ["/api/layer1-settings", (_request, response) => sendJson(response, 200, buildFixtureSettings())],
  ["/api/layer1-view", (_request, response, query) => sendFixtureView(response, query)],
  ["/api/layer1-refs", (_request, response) => sendFixtureRefs(response)],
  ["/api/layer1-sessions", (_request, response, query) => sendFixtureSessions(response, query)],
  ["/api/layer1-edits", (_request, response, query) => sendFixtureEdits(response, query)],
  ["/api/layer1-script-runs", (_request, response, query) => sendFixtureScriptRuns(response, query)],
  ["/api/layer1-branches", (_request, response, query) => sendFixtureBranches(response, query)],
  ["/api/layer1-file", (_request, response, query) => sendFixtureFile(response, query)],
  ["/api/layer1-record", (_request, response, query) => sendFixtureRecord(response, query)],
  ["/api/layer1-diff", (_request, response, query) => sendFixtureDiff(response, query)],
  ["/api/layer1-script-run", (request, response) => receiveFixtureScriptRun(request, response)],
  ["/api/layer1-script-needs", (request, response) => receiveFixtureScriptNeeds(request, response)],
  ["/api/layer1-clear-results", (_request, response) => sendFixtureClearResults(response)],
  ["/api/layer1-jfred-commit", (request, response) => receiveFixtureJfredCommit(request, response)],
  ["/api/layer1-engine-v3-steps", (_request, response) => sendJson(response, 200, { steps: buildFixtureEngineV3Steps() })],
  ["/api/scan-source",(_request, response, query) => sendFixtureScanSource(response, query)],
]);
