// Fixture mode: the canned /api/layer1-settings GET payload and the POST sink.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { BRANCHES, FIXTURE_DIR, FIXTURE_JSONL_DIR, FIXTURE_REPO } from "./viewer_api_layer1_fixture_data.ts";
import type { Layer1ProjectSettings, Layer1Settings } from "./viewer_api_layer1_settings.ts";
import { sendJson } from "./viewer_server_routes.ts";

export function buildFixtureSettings(): Layer1Settings & { defaults: Record<string, never> } {
  const project: Layer1ProjectSettings = {
    dir: FIXTURE_DIR, repo: FIXTURE_REPO, branch: BRANCHES[0]!, ref: BRANCHES[0]!,
    jsonl: [FIXTURE_JSONL_DIR], fileHistory: [],
  };
  return { lastDir: FIXTURE_DIR, projects: { [FIXTURE_DIR]: project }, defaults: {} };
}

function readFixtureChunk(): void {
}

export function receiveFixtureSettings(request: IncomingMessage, response: ServerResponse): void {
  const sendSaved = (): void => sendJson(response, 200, { saved: true });
  request.on("data", readFixtureChunk);
  request.on("end", sendSaved);
}
