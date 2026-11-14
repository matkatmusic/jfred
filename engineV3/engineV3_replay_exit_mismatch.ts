// A replayed command whose exit code differs from the record only stops the replay when the event changed a file.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RecordSource } from "../src/parse/loadTranscript.ts";
import type { FileChange } from "./engineV3_replay_snapshot.ts";

export type ExitMismatch = { error: Error; source: RecordSource; toolUseId: string; recordedIsError: boolean; replayedExitCode: number };

let pendingExitMismatches: ExitMismatch[] = [];
// The files and folders that the replay itself wrote for the commands of the current event; they are not changes the command made.
const replayOwnFilePaths = new Set<string>();

export function recordReplayOwnFile(path: string): void {
  replayOwnFilePaths.add(resolve(path));
}

// Makes the folder and every missing parent, and remembers each one that did not exist before.
export function createFolderOwnedByReplay(folder: string): void {
  const absoluteFolder = resolve(folder);
  const firstCreatedFolder = mkdirSync(absoluteFolder, { recursive: true });
  if (firstCreatedFolder === undefined) {
    return;
  }
  let createdFolder = absoluteFolder;
  while (createdFolder !== firstCreatedFolder) {
    recordReplayOwnFile(createdFolder);
    createdFolder = dirname(createdFolder);
  }
  recordReplayOwnFile(firstCreatedFolder);
}

export function addPendingExitMismatches(mismatches: ExitMismatch[]): void {
  pendingExitMismatches.push(...mismatches);
}

function formatIgnoredMismatchLine(mismatch: ExitMismatch): string {
  const recordedResult = mismatch.recordedIsError ? "error" : "ok";
  return `exit mismatch ignored (no file change): ${mismatch.source.filePath} line ${mismatch.source.lineNumber} ${mismatch.toolUseId}: recorded ${recordedResult}, replayed exit ${mismatch.replayedExitCode}`;
}

// changes is undefined when the replay has no snapshot loop: then no one knows that the event left the files alone.
export function settleExitMismatches(changes: FileChange[] | undefined): void {
  const mismatches = pendingExitMismatches;
  const ownFilePaths = new Set(replayOwnFilePaths);
  pendingExitMismatches = [];
  replayOwnFilePaths.clear();
  if (mismatches.length === 0) {
    return;
  }
  if (changes === undefined) {
    throw mismatches[0]!.error;
  }
  const commandChanges = changes.filter((change) => !ownFilePaths.has(change.path));
  if (commandChanges.length > 0) {
    throw mismatches[0]!.error;
  }
  for (const mismatch of mismatches) {
    console.log(formatIgnoredMismatchLine(mismatch));
  }
}
