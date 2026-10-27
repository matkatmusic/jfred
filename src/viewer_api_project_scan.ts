// Projects-folder scanning: project listings and JSONL file entries.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";

export type JsonlFileEntry = {
  fileName: Path;
  sizeBytes: number;
  modifiedAt: Date;
};

export type ProjectListing = {
  name: string;
  jsonlFiles: JsonlFileEntry[];
};

// Synthetic project for loose .jsonl files sitting directly in the scanned folder.
export const ROOT_PROJECT_NAME = "(root)";

function compareNewestFirst(a: JsonlFileEntry, b: JsonlFileEntry): number {
  return b.modifiedAt.getTime() - a.modifiedAt.getTime();
}

// Entries directly inside `dir` matching `matches`, newest first.
function collectJsonlEntries(dir: string, matches: (name: string) => boolean): JsonlFileEntry[] {
  const entries: JsonlFileEntry[] = [];
  for (const name of readdirSync(dir)) {
    const isMatch = matches(name);
    if (!isMatch)
      continue;
    const stats = statSync(join(dir, name));
    const isFile = stats.isFile();
    if (!isFile)
      continue;
    entries.push({ fileName: new Path(name), sizeBytes: stats.size, modifiedAt: stats.mtime });
  }
  entries.sort(compareNewestFirst);
  return entries;
}

function isJsonlName(name: string): boolean {
  return name.endsWith(".jsonl");
}

function isSubagentTranscriptName(name: string): boolean {
  const hasAgentPrefix = name.startsWith("agent-");
  const hasJsonlSuffix = name.endsWith(".jsonl");
  return hasAgentPrefix && hasJsonlSuffix;
}

// The .jsonl entries directly inside `dir`, newest first.
function listJsonlFiles(dir: string): JsonlFileEntry[] {
  return collectJsonlEntries(dir, isJsonlName);
}

// Fork-subagent transcripts under <sessionId>/subagents/ (task 375/338).
export function listSubagentTranscripts(projectDir: string, sessionId: string): JsonlFileEntry[] {
  const subagentsDir = join(projectDir, sessionId, "subagents");
  const hasSubagentsDir = existsSync(subagentsDir);
  if (!hasSubagentsDir) {
    return [];
  }
  const isDirectory = statSync(subagentsDir).isDirectory();
  if (!isDirectory) {
    return [];
  }
  const entries = collectJsonlEntries(subagentsDir, isSubagentTranscriptName);
  const prefixedEntries: JsonlFileEntry[] = [];
  for (const entry of entries) {
    const fileName = new Path(join(sessionId, "subagents", entry.fileName.toString()));
    prefixedEntries.push({ ...entry, fileName });
  }
  return prefixedEntries;
}

// A project's most recent JSONL activity, for sorting; a JSONL-less project sorts last.
function computeLatestActivity(listing: ProjectListing): number {
  if (listing.jsonlFiles.length === 0)
    return 0;
  return listing.jsonlFiles[0]!.modifiedAt.getTime();
}

function compareLatestActivity(a: ProjectListing, b: ProjectListing): number {
  return computeLatestActivity(b) - computeLatestActivity(a);
}

// Subdirectories become projects; loose .jsonl files become the "(root)" project.
export function scanProjects(projectsDir: Path): ProjectListing[] {
  const root = projectsDir.toString();
  const listings: ProjectListing[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const isDirectory = entry.isDirectory();
    if (!isDirectory)
      continue;
    listings.push({ name: entry.name, jsonlFiles: listJsonlFiles(join(root, entry.name)) });
  }
  const looseJsonlFiles = listJsonlFiles(root);
  if (looseJsonlFiles.length > 0) {
    listings.push({ name: ROOT_PROJECT_NAME, jsonlFiles: looseJsonlFiles });
  }
  listings.sort(compareLatestActivity);
  return listings;
}

// findJsonlPaths lives in viewer_api_sources.ts (task 177: 250-line cap split).
