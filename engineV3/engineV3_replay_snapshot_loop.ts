// The replay loop's snapshot work: one event file per event, written into the snapshot store.

import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { JSONLLineKind, TimelineEventKind, getJSONLLineKind, type JSONLLine, type TimelineEvent } from "./engineV3.ts";
import { listChangesSinceLastScan, type FileChange } from "./engineV3_replay_snapshot.ts";
import { listWriteEditCallIds } from "./engineV3_replay_tool_results.ts";
import { scanWatchedFolders, type FileStamp } from "./engineV3_replay_snapshot_scan.ts";
import { formatEventNumber, formatJsonlEventFileName, writeEventSnapshot } from "./engineV3_replay_snapshot_write.ts";

export type SnapshotLoop = { store: Path; watchedFolders: Path[]; previousScan: Map<string, FileStamp>; eventNumber: number; previousEventFileName: string };

const START_EVENT_FILE_NAME = "000000_start.json";
const TEMP_FOLDER = "/tmp";
const NODE_COMPILE_CACHE_FOLDER = "/tmp/node-compile-cache";

function listSkipFolders(store: Path): Path[] {
  return [store, new Path(NODE_COMPILE_CACHE_FOLDER)];
}

export function moveExistingEventsToOld(store: Path): void {
  const eventsFolder = join(store.toString(), "events");
  const hasEventsFolder = existsSync(eventsFolder);
  if (!hasEventsFolder) {
    return;
  }
  const hasEventFiles = readdirSync(eventsFolder).length > 0;
  if (!hasEventFiles) {
    return;
  }
  const oldRunFolder = join(store.toString(), "old", new Date().toISOString());
  mkdirSync(oldRunFolder, { recursive: true });
  renameSync(eventsFolder, join(oldRunFolder, "events"));
}

export function createSnapshotLoop(store: Path, watchedFolders: Path[]): SnapshotLoop {
  moveExistingEventsToOld(store);
  const startScan = scanWatchedFolders(watchedFolders, listSkipFolders(store), new Map());
  const changes = listChangesSinceLastScan(new Map(), startScan);
  writeEventSnapshot(store, START_EVENT_FILE_NAME, { event: 0, eventText: "start", previousEvent: null, changes });
  return { store, watchedFolders, previousScan: startScan, eventNumber: 0, previousEventFileName: START_EVENT_FILE_NAME };
}

export function createSnapshotLoopIfRequested(snapshotsPath: Path | undefined, state: Path, watchPaths: Path[]): SnapshotLoop | undefined {
  if (snapshotsPath === undefined) {
    return undefined;
  }
  return createSnapshotLoop(snapshotsPath, [state, new Path(TEMP_FOLDER), ...watchPaths]);
}

function formatLineEventFileName(eventNumber: number, line: JSONLLine): string {
  const source = getRecordSource(line);
  if (source === undefined) {
    throw new Error("formatLineEventFileName: the JSONL line has no source file");
  }
  return formatJsonlEventFileName(eventNumber, source.filePath, source.lineNumber);
}

function formatEventFileName(eventNumber: number, event: TimelineEvent): string {
  const paddedEventNumber = formatEventNumber(eventNumber);
  if (event.type === TimelineEventKind.GitCommit) {
    return `${paddedEventNumber}_commit_${event.commit.toString()}.json`;
  }
  if (event.type === TimelineEventKind.OutsideGitAction) {
    return `${paddedEventNumber}_outside-git_${event.row.newCommit}.json`;
  }
  if (event.type === TimelineEventKind.PlateCapture) {
    return `${paddedEventNumber}_plate_${basename(event.capture.captureFile.toString(), ".json")}.json`;
  }
  if (event.type === TimelineEventKind.IdleStateCopy) {
    return `${paddedEventNumber}_idle-state_${basename(event.copy.targetPath.toString(), ".json")}.json`;
  }
  return formatLineEventFileName(eventNumber, event.line);
}

function isWriteEditCallWithResult(line: JSONLLine, writeEditResultLines: Map<string, JSONLLine>): boolean {
  for (const callId of listWriteEditCallIds(line)) {
    const hasResult = writeEditResultLines.has(callId);
    if (hasResult) {
      return true;
    }
  }
  return false;
}

// A Write/Edit call line is not a skip line: the replay applies its result at the call line.
function isSkipLine(event: TimelineEvent, state: Path, writeEditResultLines: Map<string, JSONLLine>): boolean {
  if (event.type === TimelineEventKind.JSONLLine) {
    const kind = getJSONLLineKind(event.line, state);
    if (kind === JSONLLineKind.Skip) {
      const isCallWithResult = isWriteEditCallWithResult(event.line, writeEditResultLines);
      return !isCallWithResult;
    }
  }
  return false;
}

function removeTimeStampPrefix(eventText: string): string {
  return eventText.slice(eventText.indexOf(" ") + 1);
}

function listChangesAfterEvent(snapshotLoop: SnapshotLoop, isSkipped: boolean): FileChange[] {
  if (isSkipped) {
    return [];
  }
  const currentScan = scanWatchedFolders(snapshotLoop.watchedFolders, listSkipFolders(snapshotLoop.store), snapshotLoop.previousScan);
  const changes = listChangesSinceLastScan(snapshotLoop.previousScan, currentScan);
  snapshotLoop.previousScan = currentScan;
  return changes;
}

export function writeSnapshotAfterEvent(snapshotLoop: SnapshotLoop | undefined, event: TimelineEvent, eventText: string, state: Path, writeEditResultLines: Map<string, JSONLLine>): void {
  if (snapshotLoop === undefined) {
    return;
  }
  snapshotLoop.eventNumber++;
  const eventFileName = formatEventFileName(snapshotLoop.eventNumber, event);
  const isSkipped = isSkipLine(event, state, writeEditResultLines);
  const changes = listChangesAfterEvent(snapshotLoop, isSkipped);
  const previousEvent = snapshotLoop.previousEventFileName;
  writeEventSnapshot(snapshotLoop.store, eventFileName, { event: snapshotLoop.eventNumber, eventText: removeTimeStampPrefix(eventText), previousEvent, changes });
  snapshotLoop.previousEventFileName = eventFileName;
}
