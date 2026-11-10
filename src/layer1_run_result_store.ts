// Replay results saved per session file, so a page reload or a server restart restores them; Clear wipes them.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WireScriptResult, WireScriptResultOf } from "../webapp/layer1-wire-script-results.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { computeTranscriptFileStamp } from "./viewer_api_records.ts";

type SavedRunResult = WireScriptResultOf<Path, Uuid>;
type SessionResults = { stamp: string; resultsByToolUseId: Map<string, SavedRunResult> };
type SavedSessionResults = { stamp: string; results: WireScriptResult[] };

// ponytail: keyed by the run's own session file; a change in another session file or on disk can leave a rating stale until Clear.
const resultsBySessionFile = new Map<string, SessionResults>();
let storeFilePath: Path | undefined;

function decodeRunResult(saved: WireScriptResult): SavedRunResult {
  const files: SavedRunResult["files"] = [];
  for (const file of saved.files) {
    files.push({ ...file, path: new Path(file.path) });
  }
  return { ...saved, toolUseId: new Uuid(saved.toolUseId), files };
}

function loadStoreFromDisk(filePath: Path): void {
  const isFilePresent = existsSync(filePath.toString());
  if (!isFilePresent) {
    return;
  }
  const saved = JSON.parse(readFileSync(filePath.toString(), "utf8")) as Record<string, SavedSessionResults>;
  for (const [sessionFile, savedSession] of Object.entries(saved)) {
    const resultsByToolUseId = new Map<string, SavedRunResult>();
    for (const savedResult of savedSession.results) {
      resultsByToolUseId.set(savedResult.toolUseId, decodeRunResult(savedResult));
    }
    resultsBySessionFile.set(sessionFile, { stamp: savedSession.stamp, resultsByToolUseId });
  }
}

// Write then rename, so a crash never leaves a half file.
function saveStoreToDisk(): void {
  if (storeFilePath === undefined) {
    return;
  }
  const saved: Record<string, SavedSessionResults> = {};
  for (const [sessionFile, session] of resultsBySessionFile) {
    saved[sessionFile] = { stamp: session.stamp, results: [...session.resultsByToolUseId.values()] as unknown as WireScriptResult[] };
  }
  const tempPath = `${storeFilePath.toString()}.tmp`;
  mkdirSync(dirname(storeFilePath.toString()), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(saved));
  renameSync(tempPath, storeFilePath.toString());
}

// Opt-in (viewer only): without a file the store stays in memory. Empties memory, then loads the file.
export function setRunResultStorePersistence(file: Path): void {
  storeFilePath = file;
  resultsBySessionFile.clear();
  loadStoreFromDisk(file);
}

export function storeRunResultForSession(sessionFile: Path, result: WireScriptResult): void {
  const stamp = computeTranscriptFileStamp(sessionFile);
  const known = resultsBySessionFile.get(sessionFile.toString());
  const isKnownCurrent = known !== undefined && known.stamp === stamp;
  const session = isKnownCurrent ? known : { stamp, resultsByToolUseId: new Map<string, SavedRunResult>() };
  session.resultsByToolUseId.set(result.toolUseId, decodeRunResult(result));
  resultsBySessionFile.set(sessionFile.toString(), session);
  saveStoreToDisk();
}

// A changed session file voids its results: the stamp no longer matches.
export function listSavedRunResults(sessionFile: Path): SavedRunResult[] {
  const session = resultsBySessionFile.get(sessionFile.toString());
  if (session === undefined) {
    return [];
  }
  const currentStamp = computeTranscriptFileStamp(sessionFile);
  if (session.stamp !== currentStamp) {
    return [];
  }
  return [...session.resultsByToolUseId.values()];
}

// Empties memory and deletes the disk file.
export function clearRunResultStore(): void {
  resultsBySessionFile.clear();
  if (storeFilePath !== undefined) {
    rmSync(storeFilePath.toString(), { force: true });
  }
}
