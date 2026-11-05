// POST /api/layer1-clear-results: wipes every saved result and cache so all layers compute again.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { clearSandboxMemo } from "./reconstruction_script_sandbox_memo.ts";
import { clearDocumentCache } from "./reconstruction_document_cache.ts";
import { clearFileStampCaches } from "./file_stamp_cache.ts";
import { clearBuiltDocumentCache } from "./viewer_api.ts";
import { sendJson } from "./viewer_server_routes.ts";

// A cross-site form post cannot send this content type without a preflight, and the server sends no CORS headers.
const JSON_CONTENT_TYPE = "application/json";

// Throws unless the request is a JSON post to this server's own host.
export function assertLocalJsonPost(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  const isJsonContentType = contentType.toLowerCase().startsWith(JSON_CONTENT_TYPE);
  if (!isJsonContentType) {
    throw new Error(`content type must be ${JSON_CONTENT_TYPE}`);
  }
  const expectedHost = `127.0.0.1:${request.socket.localPort}`;
  if (request.headers.host !== expectedHost) {
    throw new Error(`host must be ${expectedHost}`);
  }
}

export function sendClearResultsResponse(request: IncomingMessage, response: ServerResponse): void {
  assertLocalJsonPost(request);
  clearSandboxMemo();
  clearBuiltDocumentCache();
  clearDocumentCache();
  clearFileStampCaches();
  sendJson(response, 200, { cleared: true });
}
