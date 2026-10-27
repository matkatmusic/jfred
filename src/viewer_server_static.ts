// Static webapp file serving for viewer_server.ts.

import { readFileSync, realpathSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { computeStaticFileRelative, findStaticFilePath } from "./viewer_api_static_files.ts";
import { sendText } from "./viewer_server_routes.ts";
import type { ServerResponse } from "node:http";

const WEBAPP_DIR = resolve(import.meta.dirname, "..", "webapp");
const WEBAPP_DIST_DIR = resolve(import.meta.dirname, "..", "webapp", "dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Serves from webapp/dist/ then webapp/, refusing any resolved path outside those roots.
export function sendStaticFile(response: ServerResponse, urlPath: string): void {
  const relative = computeStaticFileRelative(urlPath);
  const resolved = realpathSync(findStaticFilePath(relative, WEBAPP_DIST_DIR, WEBAPP_DIR));
  const isInsideWebapp = resolved.startsWith(WEBAPP_DIR + sep);
  // The dist clause is redundant today, but stops a future dist relocation opening a traversal hole.
  const isInsideDist = resolved.startsWith(WEBAPP_DIST_DIR + sep);
  const isOutsideWebapp = !isInsideWebapp && !isInsideDist;
  if (isOutsideWebapp) {
    sendText(response, 400, "path escapes webapp/");
    return;
  }
  const contentType = CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream";
  sendText(response, 200, readFileSync(resolved, "utf8"), contentType);
}
