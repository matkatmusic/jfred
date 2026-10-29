// GET /api/pick-folder: a native macOS osascript chooser; cancel or failure returns an empty path.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { sendJson } from "./viewer_server_routes.ts";

export function parsePickedPaths(stdout: string): string[] {
  const paths: string[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    const picked = line.trim().replace(/\/$/, "");
    if (picked !== "") {
      paths.push(picked);
    }
  }
  return paths;
}

// `current` seeds the dialog only when it exists on disk, since a bad seed makes osascript throw.
// ponytail: spawnSync blocks the server while the dialog is open; use spawn+promise if concurrency appears.
export function selectFolders(response: ServerResponse, query: URLSearchParams): void {
  const current = query.get("current");
  const seed = current !== null && existsSync(current)
    ? ` default location (POSIX file ${JSON.stringify(current)})`
    : "";
  const result = spawnSync("osascript", [
    // The server is a background process: without activate the dialog opens behind the browser.
    "-e", 'tell application "System Events" to activate',
    "-e", `set chosenFolders to (choose folder with prompt "Select folder"${seed} with multiple selections allowed)`,
    "-e", "set posixPaths to {}",
    "-e", "repeat with f in chosenFolders",
    "-e", "set end of posixPaths to POSIX path of f",
    "-e", "end repeat",
    "-e", "set AppleScript's text item delimiters to linefeed",
    "-e", "posixPaths as text",
  ], { encoding: "utf8" });
  // Non-zero = user cancelled (-128) or osascript failed; both are "no picks" to the client.
  const paths = result.status === 0 ? parsePickedPaths(result.stdout) : [];
  // `path` fills single-input callers; `paths` is the full multi-select result.
  sendJson(response, 200, { path: paths[0] ?? "", paths });
}
