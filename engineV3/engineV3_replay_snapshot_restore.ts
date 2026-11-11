// Rebuilds the watched files from the stored event files, and moves later event files out of the way.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import { ChangeKind, type FileChange } from "./engineV3_replay_snapshot.ts";
import type { EventSnapshot } from "./engineV3_replay_snapshot_write.ts";
import { recordTouchedPath } from "./engineV3_replay_touched.ts";

const EVENTS_FOLDER_NAME = "events";
const BLOBS_FOLDER_NAME = "blobs";
const OLD_FOLDER_NAME = "old";
const HASH_PREFIX = "sha256:";
const OCTAL_RADIX = 8;

function getEventNumber(eventFileName: string): number {
  return Number(eventFileName.split("_")[0]);
}

function listEventFileNames(store: Path): string[] {
  return readdirSync(join(store.toString(), EVENTS_FOLDER_NAME)).sort();
}

function getModeBits(change: FileChange): number {
  if (change.mode === undefined) {
    throw new Error(`getModeBits: the change for ${change.path} has no mode`);
  }
  return Number.parseInt(change.mode, OCTAL_RADIX);
}

function writeFileFromBlob(blobsFolder: string, change: FileChange): void {
  if (change.contentHash === undefined) {
    throw new Error(`writeFileFromBlob: the change for ${change.path} has no contentHash`);
  }
  copyFileSync(join(blobsFolder, change.contentHash.slice(HASH_PREFIX.length)), change.path);
  chmodSync(change.path, getModeBits(change));
}

function applyFileOrSymlinkChange(blobsFolder: string, change: FileChange): void {
  // remove first: the old path may be a symlink or a read-only file
  rmSync(change.path, { recursive: true, force: true });
  mkdirSync(dirname(change.path), { recursive: true });
  if (change.symlinkTarget !== undefined) {
    symlinkSync(change.symlinkTarget, change.path);
    return;
  }
  writeFileFromBlob(blobsFolder, change);
}

function applyChange(blobsFolder: string, change: FileChange): void {
  if (change.change === ChangeKind.Deleted) {
    rmSync(change.path, { recursive: true, force: true });
    return;
  }
  if (change.directory === true) {
    mkdirSync(change.path, { recursive: true });
    chmodSync(change.path, getModeBits(change));
    return;
  }
  applyFileOrSymlinkChange(blobsFolder, change);
}

function readEventSnapshot(store: Path, eventFileName: string): EventSnapshot {
  return JSON.parse(readFileSync(join(store.toString(), EVENTS_FOLDER_NAME, eventFileName), "utf8"));
}

export function readEventSnapshotText(store: Path, eventFileName: string): string {
  return readEventSnapshot(store, eventFileName).eventText;
}

function listEventFileNamesBefore(store: Path, startAtEvent: number): string[] {
  const eventFileNames: string[] = [];
  for (const eventFileName of listEventFileNames(store)) {
    if (getEventNumber(eventFileName) < startAtEvent) {
      eventFileNames.push(eventFileName);
    }
  }
  return eventFileNames;
}

function recordTouchedPathsOfEvent(eventFileName: string, eventSnapshot: EventSnapshot): void {
  if (eventSnapshot.touched === undefined) {
    throw new Error(`applyEventSnapshots: ${eventFileName} has no touched list; make the store again with a full run from event 0`);
  }
  for (const touchedPath of eventSnapshot.touched) {
    recordTouchedPath(touchedPath);
  }
}

function applyEventFiles(store: Path, eventFileNames: string[]): void {
  const blobsFolder = join(store.toString(), BLOBS_FOLDER_NAME);
  for (const eventFileName of eventFileNames) {
    const eventSnapshot = readEventSnapshot(store, eventFileName);
    for (const change of eventSnapshot.changes) {
      applyChange(blobsFolder, change);
    }
    recordTouchedPathsOfEvent(eventFileName, eventSnapshot);
  }
}

export function applyEventSnapshots(store: Path, startAtEvent: number): string {
  const eventFileNames = listEventFileNamesBefore(store, startAtEvent);
  const lastEventFileName = eventFileNames[eventFileNames.length - 1];
  const missingEventError = new Error(`applyEventSnapshots: the store has no event file for event ${startAtEvent - 1}`);
  if (lastEventFileName === undefined) {
    throw missingEventError;
  }
  if (getEventNumber(lastEventFileName) !== startAtEvent - 1) {
    throw missingEventError;
  }
  applyEventFiles(store, eventFileNames);
  return lastEventFileName;
}

export function moveLaterEventsToOld(store: Path, startAtEvent: number): void {
  const eventsFolder = join(store.toString(), EVENTS_FOLDER_NAME);
  const hasEventsFolder = existsSync(eventsFolder);
  if (!hasEventsFolder) {
    return;
  }
  const oldEventsFolder = join(store.toString(), OLD_FOLDER_NAME, new Date().toISOString(), EVENTS_FOLDER_NAME);
  for (const eventFileName of listEventFileNames(store)) {
    if (getEventNumber(eventFileName) >= startAtEvent) {
      mkdirSync(oldEventsFolder, { recursive: true });
      renameSync(join(eventsFolder, eventFileName), join(oldEventsFolder, eventFileName));
    }
  }
}
