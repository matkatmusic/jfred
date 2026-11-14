// Writes one event file and the content blobs it points to into the snapshot store.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import type { FileChange } from "./engineV3_replay_snapshot.ts";

export type EventSnapshot = {
  event: number;
  eventText: string;
  previousEvent: string | null;
  touched: string[];
  changes: FileChange[];
};

const EVENTS_FOLDER_NAME = "events";
const BLOBS_FOLDER_NAME = "blobs";
const HASH_PREFIX = "sha256:";
const EVENT_NUMBER_DIGITS = 6;

export function formatEventNumber(eventNumber: number): string {
  return String(eventNumber).padStart(EVENT_NUMBER_DIGITS, "0");
}

export function formatJsonlEventFileName(eventNumber: number, jsonlFileName: string, line: number): string {
  return `${formatEventNumber(eventNumber)}_${basename(jsonlFileName, ".jsonl")}_${line}.json`;
}

function writeMissingBlobs(blobsFolder: string, changes: FileChange[]): void {
  mkdirSync(blobsFolder, { recursive: true });
  for (const change of changes) {
    if (change.contentHash === undefined) {
      continue;
    }
    const blobPath = join(blobsFolder, change.contentHash.slice(HASH_PREFIX.length));
    const blobExists = existsSync(blobPath);
    if (!blobExists) {
      copyFileSync(change.path, blobPath);
    }
  }
}

export function writeEventSnapshot(store: Path, eventFileName: string, snapshot: EventSnapshot): void {
  writeMissingBlobs(join(store.toString(), BLOBS_FOLDER_NAME), snapshot.changes);
  const eventsFolder = join(store.toString(), EVENTS_FOLDER_NAME);
  mkdirSync(eventsFolder, { recursive: true });
  const { event, eventText, previousEvent, touched, changes } = snapshot;
  const eventFile = { event, eventText, replayedAt: new Date().toISOString(), previousEvent, touched, changes };
  writeFileSync(join(eventsFolder, eventFileName), JSON.stringify(eventFile, null, 4) + "\n");
}
