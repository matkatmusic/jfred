// GET /api/scan-source: checks a folder holds sources to add; also the recursive walker for /api/layer1-sessions.

import { existsSync, readdirSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { requireExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";

// The Workflow tool's journal is not a chat transcript.
const WORKFLOW_JOURNAL_NAME = "journal.jsonl";

// Claude Code's prompt history is not a chat transcript.
const PROMPT_HISTORY_NAME = "history.jsonl";

// File-history snapshots have hash names with no common extension, so only the JSONL kind filters by name.
function matchesSourceKind(name: string, kind: SourceKind): boolean {
  if (kind === SourceKind.jsonl) {
    return name.endsWith(".jsonl") && name !== WORKFLOW_JOURNAL_NAME && name !== PROMPT_HISTORY_NAME;
  }
  return true;
}

// Every matching file under `root` at any depth, up to `limit`. Symlinked folders are not followed.
export function listSourceFilesUnder(root: Path, kind: SourceKind, limit = Number.MAX_SAFE_INTEGER): Path[] {
  const found: Path[] = [];
  const pending: string[] = [root.toString()];
  while (pending.length > 0 && found.length < limit) {
    const folder = pending.pop()!;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pending.push(join(folder, entry.name));
        continue;
      }
      if (entry.isFile() && matchesSourceKind(entry.name, kind)) {
        found.push(new Path(join(folder, entry.name)));
        if (found.length >= limit) {
          break;
        }
      }
    }
  }
  return found;
}

export function countSourceFilesUnder(root: Path, kind: SourceKind, limit: number): number {
  return listSourceFilesUnder(root, kind, limit).length;
}

// Every transcript under every picked folder, de-duplicated by absolute path (two folders may nest or repeat).
export function listTranscriptFiles(folders: readonly string[]): Path[] {
  const byPath = new Map<string, Path>();
  for (const folder of folders) {
    // A DERIVED default source folder need not exist yet: empty list, not a bad request.
    if (!existsSync(folder)) {
      continue;
    }
    for (const jsonlPath of listSourceFilesUnder(new Path(folder), SourceKind.jsonl)) {
      byPath.set(jsonlPath.toString(), jsonlPath);
    }
  }
  return [...byPath.values()];
}

// `kind` comes from a URL, so an unknown value throws a 400 naming it (coding-requirements §4).
function requireSourceKind(query: URLSearchParams): SourceKind {
  const value = requireParam(query, "kind");
  if (value === SourceKind.jsonl) {
    return SourceKind.jsonl;
  }
  if (value === SourceKind.fileHistory) {
    return SourceKind.fileHistory;
  }
  throw new Error(`unknown source kind: ${value}`);
}

// GET /api/scan-source returns { found }, capped at 1. A bad `path` throws; the outer catch sends 400.
export function handleScanSourceRequest(response: ServerResponse, query: URLSearchParams): void {
  const root = requireExistingFolderParam(query, "path");
  sendJson(response, 200, { found: countSourceFilesUnder(root, requireSourceKind(query), 1) });
}
