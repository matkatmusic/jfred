// The Layer 1 View's HTTP routes, dispatched as one group; returns whether it owned the request.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { handleLayer1BranchesRequest } from "./viewer_api_layer1_branches.ts";
import { handleLayer1DiffContentRequest, handleLayer1DiffRequest } from "./viewer_api_layer1_diff.ts";
import { handleLayer1EditsRequest } from "./viewer_api_layer1_edits.ts";
import { handleLayer1FileRequest } from "./viewer_api_layer1_file.ts";
import { handleLayer1RecordRequest } from "./viewer_api_layer1_record.ts";
import { handleLayer1RefsRequest } from "./viewer_api_layer1_refs.ts";
import { handleLayer1ViewRequest } from "./viewer_api_layer1_route.ts";
import { handleLayer1ScriptRunsRequest } from "./viewer_api_layer1_script_runs.ts";
import { sendLayer1SessionsResponse } from "./viewer_api_layer1_sessions.ts";
import { sendLayer1Settings, receiveLayer1SettingsUpdate } from "./viewer_api_layer1_settings.ts";
import { handleScanSourceRequest } from "./viewer_api_layer1_sources.ts";
import { dispatchLayer1FixtureRoute, isFixtureMode } from "./viewer_api_layer1_fixture.ts";

export function dispatchLayer1Route(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  // Task 329: pure content-in/diff-out, no data source behind it — so fixture mode shares it too.
  const isPost = request.method === "POST";
  const isDiffContentPath = url.pathname === "/api/layer1-diff-content";
  const isDiffContentPost = isPost && isDiffContentPath;
  if (isDiffContentPost) {
    handleLayer1DiffContentRequest(request, response);
    return true;
  }
  // Task 330: --fixture serves these same paths from canned payloads; off by default, so nothing else changes.
  const isFixture = isFixtureMode();
  if (isFixture) {
    return dispatchLayer1FixtureRoute(request, response, url);
  }
  // The POST test precedes the GET one for the same path, exactly as /api/config is ordered.
  const isSettingsPath = url.pathname === "/api/layer1-settings";
  const isSettingsPost = isPost && isSettingsPath;
  if (isSettingsPost) {
    receiveLayer1SettingsUpdate(request, response);
  }
  else if (isSettingsPath) {
    sendLayer1Settings(response);
  }
  else if (url.pathname === "/api/layer1-view") {
    handleLayer1ViewRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-refs") {
    handleLayer1RefsRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-sessions") {
    sendLayer1SessionsResponse(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-edits") {
    handleLayer1EditsRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-script-runs") {
    handleLayer1ScriptRunsRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-branches") {
    handleLayer1BranchesRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-record") {
    handleLayer1RecordRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-file") {
    handleLayer1FileRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/layer1-diff") {
    handleLayer1DiffRequest(response, url.searchParams);
  }
  else if (url.pathname === "/api/scan-source") {
    handleScanSourceRequest(response, url.searchParams);
  }
  else {
    return false;
  }
  return true;
}
