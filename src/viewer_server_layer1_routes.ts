// The Layer 1 View's HTTP routes, dispatched as one group; returns whether it owned the request.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { sendLayer1BranchesResponse } from "./viewer_api_layer1_branches.ts";
import { sendLayer1Diff, sendLayer1DiffContent } from "./viewer_api_layer1_diff.ts";
import { sendLayer1EditsResponse } from "./viewer_api_layer1_edits.ts";
import { sendLayer1FileResponse } from "./viewer_api_layer1_file.ts";
import { sendLayer1Record } from "./viewer_api_layer1_record.ts";
import { sendLayer1RefsResponse } from "./viewer_api_layer1_refs.ts";
import { receiveJfredCommit, receiveJfredDelete } from "./viewer_api_layer1_jfred_route.ts";
import { sendLayer1ViewResponse } from "./viewer_api_layer1_route.ts";
import { sendClearResultsResponse } from "./viewer_api_clear_results.ts";
import { receiveScriptNeeds } from "./viewer_api_layer1_script_needs.ts";
import { receiveScriptRun } from "./viewer_api_layer1_script_run.ts";
import { sendLayer1ScriptRunsResponse } from "./viewer_api_layer1_script_runs.ts";
import { sendLayer1SessionsResponse } from "./viewer_api_layer1_sessions.ts";
import { sendLayer1Settings, receiveLayer1SettingsUpdate } from "./viewer_api_layer1_settings.ts";
import { sendScanSourceResponse } from "./viewer_api_layer1_sources.ts";
import { dispatchLayer1FixtureRoute, isFixtureMode } from "./viewer_api_layer1_fixture.ts";

type Layer1RouteHandler = (request: IncomingMessage, response: ServerResponse, url: URL) => void;

// POST updates the settings; any other method reads them.
function dispatchLayer1Settings(request: IncomingMessage, response: ServerResponse): void {
  const isSettingsPost = request.method === "POST";
  if (isSettingsPost) {
    receiveLayer1SettingsUpdate(request, response);
    return;
  }
  sendLayer1Settings(response);
}

const LAYER1_ROUTES = new Map<string, Layer1RouteHandler>([
  ["/api/layer1-settings", (request, response) => dispatchLayer1Settings(request, response)],
  ["/api/layer1-script-run", (request, response, url) => receiveScriptRun(request, response, url)],
  ["/api/layer1-script-needs", (request, response, url) => receiveScriptNeeds(request, response, url)],
  ["/api/layer1-clear-results", (request, response) => sendClearResultsResponse(request, response)],
  ["/api/layer1-jfred-commit", (request, response, url) => receiveJfredCommit(request, response, url)],
  ["/api/layer1-jfred-delete", (request, response, url) => receiveJfredDelete(request, response, url)],
  ["/api/layer1-view", (_request, response, url) => sendLayer1ViewResponse(response, url.searchParams)],
  ["/api/layer1-refs", (_request, response, url) => sendLayer1RefsResponse(response, url.searchParams)],
  ["/api/layer1-sessions", (_request, response, url) => sendLayer1SessionsResponse(response, url.searchParams)],
  ["/api/layer1-edits", (_request, response, url) => sendLayer1EditsResponse(response, url.searchParams)],
  ["/api/layer1-script-runs", (_request, response, url) => sendLayer1ScriptRunsResponse(response, url.searchParams)],
  ["/api/layer1-branches", (_request, response, url) => sendLayer1BranchesResponse(response, url.searchParams)],
  ["/api/layer1-record", (_request, response, url) => sendLayer1Record(response, url.searchParams)],
  ["/api/layer1-file", (_request, response, url) => sendLayer1FileResponse(response, url.searchParams)],
  ["/api/layer1-diff", (_request, response, url) => sendLayer1Diff(response, url.searchParams)],
  ["/api/scan-source", (_request, response, url) => sendScanSourceResponse(response, url.searchParams)],
]);

function dispatchLayer1TableRoute(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  const routeHandler = LAYER1_ROUTES.get(url.pathname);
  if (routeHandler === undefined) {
    return false;
  }
  routeHandler(request, response, url);
  return true;
}

// Diff-content needs no data source, so it answers first, in fixture mode too.
export function dispatchLayer1Route(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  const isDiffContentPost = request.method === "POST" && url.pathname === "/api/layer1-diff-content";
  if (isDiffContentPost) {
    sendLayer1DiffContent(request, response);
    return true;
  }
  const isFixture = isFixtureMode();
  if (isFixture) {
    return dispatchLayer1FixtureRoute(request, response, url);
  }
  return dispatchLayer1TableRoute(request, response, url);
}
