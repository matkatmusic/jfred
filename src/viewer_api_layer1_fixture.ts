// Fixture mode: the Layer 1 routes served from canned payloads, off by default.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { receiveFixtureSettings } from "./viewer_api_layer1_fixture_settings.ts";
import { FIXTURE_ROUTES } from "./viewer_api_layer1_fixture_routes.ts";

let fixtureModeOn = false;
export function enableFixtureMode(): void {
  fixtureModeOn = true;
}
export function isFixtureMode(): boolean {
  return fixtureModeOn;
}

export function dispatchLayer1FixtureRoute(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  const isSettingsPost = request.method === "POST" && url.pathname === "/api/layer1-settings";
  if (isSettingsPost) {
    receiveFixtureSettings(request, response);
    return true;
  }
  const routeHandler = FIXTURE_ROUTES.get(url.pathname);
  if (routeHandler === undefined) {
    return false;
  }
  routeHandler(request, response, url.searchParams);
  return true;
}
