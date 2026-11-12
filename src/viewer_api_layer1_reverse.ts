// HTTP surface for GET /api/layer1-reverse; parses and frames only, layer1_reverse_wire.ts shapes the walk.

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { type ServerResponse } from "node:http";
// import { walkFileBackwardsWithKnownStates } from "../engineV3/engineV3_replay_reverse.ts";
import { type ReverseFileState } from "../engineV3/engineV3_replay_reverse.ts";
import { getReverseStatesForFile } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildReverseWalkWire } from "./layer1_reverse_wire.ts";
import { Path } from "./structures/domain.ts";
import { validateExistingFolderParam, sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";

function getRequiredJsonlFolders(query: URLSearchParams): Path[] {
  const jsonlFolders = query.getAll("jsonl");
  if (jsonlFolders.length === 0) {
    throw new Error("missing query param: jsonl");
  }
  return jsonlFolders.map((jsonlFolder) => new Path(jsonlFolder));
}

// function getRequiredFirstJsonlFolder(query: URLSearchParams): Path {
//   // ponytail: first jsonl folder only; pass all folders when the engine walk takes a list
//   const firstJsonlFolder = query.getAll("jsonl")[0];
//   if (firstJsonlFolder === undefined) {
//     throw new Error("missing query param: jsonl");
//   }
//   return new Path(firstJsonlFolder);
// }

function resolveFileInsideFolder(folder: Path, relativeFilePath: string): Path {
  if (isAbsolute(relativeFilePath)) {
    throw new Error(`path must be relative to dir, not absolute: ${relativeFilePath}`);
  }
  const file = join(folder.toString(), relativeFilePath);
  const fileFromFolder = relative(folder.toString(), file);
  if (fileFromFolder === "..") {
    throw new Error(`path is outside dir: ${relativeFilePath}`);
  }
  if (fileFromFolder.startsWith(".." + sep)) {
    throw new Error(`path is outside dir: ${relativeFilePath}`);
  }
  return new Path(file);
}

// ponytail: in-memory, keyed by file mtime; a transcript-only change does not refresh it
const reverseStatesByCacheKey = new Map<string, ReverseFileState[]>();

function createReverseCacheKey(file: Path, jsonlFolders: Path[], fileHistoryFolders: Path[]): string {
  let fileStamp = "absent";
  if (existsSync(file.toString())) {
    const fileStats = statSync(file.toString());
    fileStamp = `${fileStats.mtimeMs}:${fileStats.size}`;
  }
  return JSON.stringify([file.toString(), jsonlFolders.map((folder) => folder.toString()), fileHistoryFolders.map((folder) => folder.toString()), fileStamp]);
}

function getCachedReverseStates(file: Path, jsonlFolders: Path[], fileHistoryFolders: Path[]): ReverseFileState[] {
  const cacheKey = createReverseCacheKey(file, jsonlFolders, fileHistoryFolders);
  const cachedStates = reverseStatesByCacheKey.get(cacheKey);
  if (cachedStates !== undefined) {
    return cachedStates;
  }
  const states = getReverseStatesForFile(file, jsonlFolders, fileHistoryFolders).states;
  reverseStatesByCacheKey.set(cacheKey, states);
  return states;
}

// A bad param throws before any header, so the server's outer catch 400s it.
export function sendLayer1ReverseResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectFolder = validateExistingFolderParam(query, "dir");
  const relativeFilePath = getRequiredParam(query, "path");
  const jsonlFolders = getRequiredJsonlFolders(query);
  const file = resolveFileInsideFolder(projectFolder, relativeFilePath);
  const fileHistoryFolders = query.getAll("snapshots").map((snapshotsFolder) => new Path(snapshotsFolder));
  // const buildWire = () => buildReverseWalkWire(relativeFilePath, walkFileBackwardsWithKnownStates(file, jsonlFolders));
  // const buildWire = () => buildReverseWalkWire(relativeFilePath, walkFileBackwardsWithKnownStates(file, jsonlFolders, fileHistoryFolders));
  const buildWire = () => buildReverseWalkWire(relativeFilePath, getCachedReverseStates(file, jsonlFolders, fileHistoryFolders));
  const progressParam = query.get("progress");
  if (progressParam !== "1") {
    sendJson(response, 200, buildWire());
    return;
  }
  sendNdjsonBuild(response, buildWire);
}
