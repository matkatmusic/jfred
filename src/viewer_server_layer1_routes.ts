// The Layer 1 View's nine HTTP routes, dispatched as one group.
//
// Split out of viewer_server.ts at its 250-line cap; a new Layer 1 endpoint costs that file nothing.
//
// Returns whether it OWNED the request, so the caller's chain falls through unchanged when it did not.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { handleLayer1DiffContentRequest, handleLayer1DiffRequest } from "./viewer_api_layer1_diff.ts";
import { handleLayer1FileRequest } from "./viewer_api_layer1_file.ts";
import { handleLayer1RefsRequest } from "./viewer_api_layer1_refs.ts";
import { handleLayer1ViewRequest } from "./viewer_api_layer1_route.ts";
import { handleLayer1SessionsRequest } from "./viewer_api_layer1_sessions.ts";
import { handleLayer1SettingsRequest, handleLayer1SettingsUpdate } from "./viewer_api_layer1_settings.ts";
import { handleScanSourceRequest } from "./viewer_api_layer1_sources.ts";
import { dispatchLayer1FixtureRoute, isFixtureMode } from "./viewer_api_layer1_fixture.ts";

export function dispatchLayer1Route(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    // Task 329: pure content-in/diff-out, no data source behind it — so fixture mode shares it too.
    if (request.method === "POST" && url.pathname === "/api/layer1-diff-content") {
        handleLayer1DiffContentRequest(request, response);
        return true;
    }
    // Task 330: --fixture serves these same paths from canned payloads; off by default, so nothing else changes.
    if (isFixtureMode()) {
        return dispatchLayer1FixtureRoute(request, response, url);
    }
    // The POST test precedes the GET one for the same path, exactly as /api/config is ordered.
    if (request.method === "POST" && url.pathname === "/api/layer1-settings") {
        handleLayer1SettingsUpdate(request, response);
    } else if (url.pathname === "/api/layer1-settings") {
        handleLayer1SettingsRequest(response);
    } else if (url.pathname === "/api/layer1-view") {
        handleLayer1ViewRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-refs") {
        handleLayer1RefsRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-sessions") {
        handleLayer1SessionsRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-file") {
        handleLayer1FileRequest(response, url.searchParams);
    } else if (url.pathname === "/api/layer1-diff") {
        handleLayer1DiffRequest(response, url.searchParams);
    } else if (url.pathname === "/api/scan-source") {
        handleScanSourceRequest(response, url.searchParams);
    } else {
        return false;
    }
    return true;
}
