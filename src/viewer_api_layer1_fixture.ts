// Fixture mode: the Layer 1 routes served from canned payloads, off by default.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Layer1RefsView, type RepoCommitRow, SourceKind, type WireSession } from "../webapp/layer1-wire.ts";
import { sendFixtureDiff, sendFixtureFile } from "./viewer_api_layer1_fixture_file.ts";
import { buildFixtureLayer1View } from "./viewer_api_layer1_fixture_view.ts";
import {
  BRANCHES, COMMITS, FIXTURE_DIR, FIXTURE_JSONL_DIR, FIXTURE_REPO, SESSIONS,
  buildSessionFile, parseMs,
} from "./viewer_api_layer1_fixture_data.ts";
import type { FixtureCommit } from "./viewer_api_layer1_fixture_data.ts";
import { SNAPSHOTS } from "./viewer_api_layer2_fixture_data.ts";
import { buildFixtureEditsPayload } from "./viewer_api_layer3_fixture_replay.ts";
import { buildFixtureScriptRunsPayload } from "./viewer_api_layer4_fixture_payload.ts";
import { buildFixtureBranchesPayload } from "./viewer_api_layer5_mockup_branches.ts";
import type { Layer1ProjectSettings, Layer1Settings } from "./viewer_api_layer1_settings.ts";
import { streamNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

let fixtureModeOn = false;
export function enableFixtureMode(): void {
  fixtureModeOn = true;
}
export function isFixtureMode(): boolean {
  return fixtureModeOn;
}

// ---- the nine canned routes ----

function sendFixtureView(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureLayer1View());
    return;
  }
  streamNdjsonBuild(response, buildFixtureLayer1View);
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

function compareSessionsByStart(left: WireSession, right: WireSession): number {
  return left.started.localeCompare(right.started);
}

function buildFixtureSessions(): WireSession[] {
  const sessions: WireSession[] = [];
  for (const session of SESSIONS) {
    // Real transcripts record ABSOLUTE paths; the pane relativizes against the project folder.
    const paths: string[] = [];
    for (const path of session.paths) {
      paths.push(`${FIXTURE_DIR}/${path}`);
    }
    sessions.push({
      file: session.file,
      fullPath: buildSessionFile(session.file).toString(),
      titles: session.titles.map((range) => range.title),
      started: new Date(parseMs(session.started)).toISOString(),
      ended: new Date(parseMs(session.ended)).toISOString(),
      paths,
    });
  }
  return sessions.sort(compareSessionsByStart);
}

function buildFixtureSessionsPayload(): { sessions: WireSession[] } {
  return { sessions: buildFixtureSessions() };
}

function sendFixtureSessions(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureSessionsPayload());
    return;
  }
  streamNdjsonBuild(response, buildFixtureSessionsPayload);
}

function ignoreFixtureProgress(): void {
}

function sendFixtureEdits(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureEditsPayload(ignoreFixtureProgress));
    return;
  }
  streamNdjsonBuild(response, buildFixtureEditsPayload);
}

function sendFixtureScriptRuns(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureScriptRunsPayload(ignoreFixtureProgress));
    return;
  }
  streamNdjsonBuild(response, buildFixtureScriptRunsPayload);
}

function sendFixtureBranches(response: ServerResponse, query: URLSearchParams): void {
  const isProgressStream = query.get("progress") === "1";
  if (!isProgressStream) {
    sendJson(response, 200, buildFixtureBranchesPayload(ignoreFixtureProgress));
    return;
  }
  streamNdjsonBuild(response, buildFixtureBranchesPayload);
}

function buildFixtureSettings():Layer1Settings & { defaults: Record<string, never> } {
  const project: Layer1ProjectSettings = {
    dir: FIXTURE_DIR, repo: FIXTURE_REPO, branch: BRANCHES[0]!, ref: BRANCHES[0]!,
    jsonl: [FIXTURE_JSONL_DIR], fileHistory: [],
  };
  return { lastDir: FIXTURE_DIR, projects: { [FIXTURE_DIR]: project }, defaults: {} };
}

function readFixtureChunk(): void {
}

function receiveFixtureSettings(request: IncomingMessage, response: ServerResponse): void {
  const sendSaved = (): void => sendJson(response, 200, { saved: true });
  request.on("data", readFixtureChunk);
  request.on("end", sendSaved);
}

function sendFixtureScanSource(response: ServerResponse, query: URLSearchParams): void {
  const kind = getRequiredParam(query, "kind");
  const found = kind === SourceKind.jsonl ? SESSIONS.length : SNAPSHOTS.length;
  sendJson(response, 200, { found });
}

export function dispatchLayer1FixtureRoute(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  const isSettingsPost = request.method === "POST" && url.pathname === "/api/layer1-settings";
  if (isSettingsPost) {
    receiveFixtureSettings(request, response);
  }
  else if (url.pathname === "/api/layer1-settings") {
    sendJson(response, 200, buildFixtureSettings());
  }
  else if (url.pathname === "/api/layer1-view") {
    sendFixtureView(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-refs") {
    sendFixtureRefs(response);
  }
  else if (url.pathname === "/api/layer1-sessions") {
    sendFixtureSessions(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-edits") {
    sendFixtureEdits(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-script-runs") {
    sendFixtureScriptRuns(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-branches") {
    sendFixtureBranches(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-file") {
    sendFixtureFile(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-diff") {
    sendFixtureDiff(response, url.searchParams);
  }
  else if (url.pathname === "/api/scan-source") {
    sendFixtureScanSource(response, url.searchParams);
  }
  else {
    return false;
  }
  return true;
}
