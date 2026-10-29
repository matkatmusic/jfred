// Static-file URL mapping for the viewer server.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `/` maps to index.html; `/app/*` prefixes strip to plain asset names.
export function computeStaticFileRelative(urlPath: string): string {
  if (urlPath === "/") {
    return "index.html";
  }
  return urlPath.replace(/^\/app\//, "").replace(/^\//, "");
}

// Prefer compiled webapp/dist copy; fall back to webapp/ source.
export function findStaticFilePath(relative: string, distDir: string, webappDir: string): string {
  const compiledCandidate = resolve(distDir, relative);
  const hasCompiledCopy = existsSync(compiledCandidate);
  if (hasCompiledCopy) {
    return compiledCandidate;
  }
  return resolve(webappDir, relative);
}
