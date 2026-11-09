// Maps a data-component name to the webapp file and line where it is written.

import type { ServerResponse } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";
import { Path } from "./structures/domain.ts";

export type ComponentSource = { file: Path; line: number };

const SKIPPED_FOLDER_NAMES = new Set(["dist", "vendor", "archive"]);
const SEARCHED_EXTENSIONS = new Set([".html", ".ts"]);

function replaceRegExpSpecialCharacters(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSearchedFile(relativePath: string): boolean {
  const folderNames = relativePath.split(sep).slice(0, -1);
  for (const folderName of folderNames) {
    const isSkippedFolder = SKIPPED_FOLDER_NAMES.has(folderName);
    if (isSkippedFolder) {
      return false;
    }
  }
  return SEARCHED_EXTENSIONS.has(extname(relativePath));
}

function collectLineMatches(file: Path, componentPattern: RegExp): ComponentSource[] {
  const matches: ComponentSource[] = [];
  const lines = readFileSync(file.toString(), "utf8").split("\n");
  for (const [lineIndex, lineText] of lines.entries()) {
    const isComponentLine = componentPattern.test(lineText);
    if (isComponentLine) {
      matches.push({ file, line: lineIndex + 1 });
    }
  }
  return matches;
}

function collectComponentMatches(webappDir: Path, componentName: string): ComponentSource[] {
  // Matches HTML data-component="X" and TS "data-component": "X", in either quote style.
  const componentPattern = new RegExp(`data-component["']?\\s*[=:]\\s*["']${replaceRegExpSpecialCharacters(componentName)}["']`);
  const matches: ComponentSource[] = [];
  for (const relativePath of readdirSync(webappDir.toString(), { recursive: true, encoding: "utf8" })) {
    const isSearched = isSearchedFile(relativePath);
    if (isSearched) {
      const file = new Path(join(webappDir.toString(), relativePath));
      matches.push(...collectLineMatches(file, componentPattern));
    }
  }
  return matches;
}

function formatMatchLocations(matches: ComponentSource[]): string {
  const locations: string[] = [];
  for (const match of matches) {
    locations.push(`${match.file}:${match.line}`);
  }
  return locations.join(", ");
}

export function findComponentSource(webappDir: Path, componentName: string): ComponentSource {
  const matches = collectComponentMatches(webappDir, componentName);
  const [firstMatch] = matches;
  if (firstMatch === undefined) {
    throw new Error(`no data-component="${componentName}" found under ${webappDir}`);
  }
  if (matches.length > 1) {
    throw new Error(`data-component="${componentName}" is written more than once: ${formatMatchLocations(matches)}`);
  }
  return firstMatch;
}

export function sendComponentSourceResponse(response: ServerResponse, query: URLSearchParams): void {
  const componentName = getRequiredParam(query, "name");
  const webappDir = new Path(join(import.meta.dirname, "..", "webapp"));
  const { file, line } = findComponentSource(webappDir, componentName);
  sendJson(response, 200, { file, line });
}
