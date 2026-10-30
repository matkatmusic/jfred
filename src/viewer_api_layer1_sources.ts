// GET /api/scan-source (task 296) plus the recursive walker; the scan is the walk stopped at the first hit.

import { existsSync, readdirSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { validateExistingFolderParam } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

// The Workflow tool's journal is not a chat transcript.
const WORKFLOW_JOURNAL_NAME = "journal.jsonl";

// Claude Code's prompt history is not a chat transcript.
const PROMPT_HISTORY_NAME = "history.jsonl";

// File-history snapshots are named by hash, so every regular file matches; only JSONL narrows by name.
function isMatchingSourceKind(name: string, kind: SourceKind): boolean {
  if (kind === SourceKind.jsonl) {
    return name.endsWith(".jsonl") && name !== WORKFLOW_JOURNAL_NAME && name !== PROMPT_HISTORY_NAME;
  }
  return true;
}

// Every matching file under `root` at any depth, up to `limit`; symlinked folders are not followed.
export function listSourceFilesUnder(root: Path, kind: SourceKind, limit = Number.MAX_SAFE_INTEGER): Path[] {
  const found: Path[] = [];
  const pending: string[] = [root.toString()];
  for (;;) {
    const hasPending = pending.length > 0;
    const isUnderLimit = found.length < limit;
    const isWorkDone = !hasPending || !isUnderLimit;
    if (isWorkDone) {
      break;
    }
    const folder = pending.pop()!;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const isDirectory = entry.isDirectory();
      if (isDirectory) {
        pending.push(join(folder, entry.name));
        continue;
      }
      const isFile = entry.isFile();
      const isKindMatch = isMatchingSourceKind(entry.name, kind);
      const isWantedFile = isFile && isKindMatch;
      if (isWantedFile) {
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
    const folderExists = existsSync(folder);
    if (!folderExists) {
      continue;
    }
    for (const jsonlPath of listSourceFilesUnder(new Path(folder), SourceKind.jsonl)) {
      byPath.set(jsonlPath.toString(), jsonlPath);
    }
  }
  return [...byPath.values()];
}

// `kind` comes from a URL, so an unknown spelling is a 400 naming it.
function getSourceKindParam(query: URLSearchParams): SourceKind {
  const value = getRequiredParam(query, "kind");
  if (value === SourceKind.jsonl) {
    return SourceKind.jsonl;
  }
  if (value === SourceKind.fileHistory) {
    return SourceKind.fileHistory;
  }
  throw new Error(`unknown source kind: ${value}`);
}

// GET /api/scan-source answers { found } capped at 1; a bad `path` throws and the outer catch 400s.
export function sendScanSourceResponse(response: ServerResponse, query: URLSearchParams): void {
  const root = validateExistingFolderParam(query, "path");
  const kind = getSourceKindParam(query);
  sendJson(response, 200, { found: countSourceFilesUnder(root, kind, 1) });
}
