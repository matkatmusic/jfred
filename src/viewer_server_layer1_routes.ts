// The Layer 1 View's six HTTP routes, dispatched as one group.
//
// Split out of viewer_server.ts, which sat exactly at the repo's 250-line cap when tasks 292, 295, 296 and 297 added three more endpoints. The page's routes are the natural seam: they share a prefix and a page, so one lookup here is one branch there and the next Layer 1 endpoint costs viewer_server.ts nothing (precedent: viewer_api_sources.ts, split off viewer_server_routes.ts for the same cap).
//
// Returns whether it OWNED the request, so the caller's chain falls through unchanged when it did not.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { handleLayer1FileRequest } from "./viewer_api_layer1_file.ts";
import { handleLayer1RefsRequest } from "./viewer_api_layer1_refs.ts";
import { handleLayer1ViewRequest } from "./viewer_api_layer1_route.ts";
import { handleLayer1SessionsRequest } from "./viewer_api_layer1_sessions.ts";
import { handleLayer1SettingsRequest, handleLayer1SettingsUpdate } from "./viewer_api_layer1_settings.ts";
import { handleScanSourceRequest } from "./viewer_api_layer1_sources.ts";

export function dispatchLayer1Route(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
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
    } else if (url.pathname === "/api/scan-source") {
        handleScanSourceRequest(response, url.searchParams);
    } else {
        return false;
    }
    return true;
}
