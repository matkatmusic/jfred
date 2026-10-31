// Per-file derived-value caches keyed by path, mtimeMs, and size, saved to one JSON file across restarts.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Path } from "./structures/domain.ts";
import { computeTranscriptFileStamp } from "./viewer_api_records.ts";

const CACHE_FILE_FORMAT_VERSION = 1;

export type FileStampCodec<Value> = { encode(value: Value): unknown; decode(json: unknown): Value };

type CacheEntry<Value> = { stamp: string; value: Value };
type SavedEntries = Record<string, { stamp: string; value: unknown }>;
type SavedCacheFile = { version: number; caches: Record<string, SavedEntries> };

interface SavableCache {
  encodeEntries(): SavedEntries;
  decodeEntries(saved: SavedEntries): void;
  clearEntries(): void;
}

const registeredCaches = new Map<string, SavableCache>();
let cacheFilePath: Path | undefined;
let hasLoadedCacheFile = false;
let hasUnsavedEntries = false;

// Without a path nothing is read or written, so in-process tests never touch the home folder.
export function setFileStampCachePath(path: Path): void {
  cacheFilePath = path;
  hasLoadedCacheFile = false;
}

// Test hook: forget every in-memory entry, so the next lookup reloads from the file.
export function clearFileStampCaches(): void {
  for (const cache of registeredCaches.values()) {
    cache.clearEntries();
  }
  hasLoadedCacheFile = false;
  hasUnsavedEntries = false;
}

function loadCacheFileOnce(): void {
  if (cacheFilePath === undefined || hasLoadedCacheFile) {
    return;
  }
  hasLoadedCacheFile = true;
  if (!existsSync(cacheFilePath.toString())) {
    return;
  }
  const saved = JSON.parse(readFileSync(cacheFilePath.toString(), "utf8")) as SavedCacheFile;
  if (saved.version !== CACHE_FILE_FORMAT_VERSION) {
    return;
  }
  for (const [name, entries] of Object.entries(saved.caches)) {
    registeredCaches.get(name)?.decodeEntries(entries);
  }
}

// Write then rename, so a crash never leaves a half file. A no-op when nothing new was computed.
export function saveFileStampCachesIfChanged(): void {
  if (cacheFilePath === undefined || !hasUnsavedEntries) {
    return;
  }
  const caches: Record<string, SavedEntries> = {};
  for (const [name, cache] of registeredCaches) {
    caches[name] = cache.encodeEntries();
  }
  const tempPath = `${cacheFilePath.toString()}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ version: CACHE_FILE_FORMAT_VERSION, caches }));
  renameSync(tempPath, cacheFilePath.toString());
  hasUnsavedEntries = false;
}

// ponytail: one entry per JSONL file; add LRU if file counts grow far past ~12k. Hold only SMALL derived values, never TranscriptRecord[].
export class FileStampCache<Value> implements SavableCache {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  constructor(name: string, private readonly codec: FileStampCodec<Value>) {
    registeredCaches.set(name, this);
  }

  readThrough(path: Path, buildValue: () => Value): Value {
    loadCacheFileOnce();
    const stamp = computeTranscriptFileStamp(path);
    const entry = this.entries.get(path.toString());
    if (entry !== undefined && entry.stamp === stamp) {
      return entry.value;
    }
    const value = buildValue();
    this.entries.set(path.toString(), { stamp, value });
    hasUnsavedEntries = true;
    return value;
  }

  encodeEntries(): SavedEntries {
    const saved: SavedEntries = {};
    for (const [path, entry] of this.entries) {
      saved[path] = { stamp: entry.stamp, value: this.codec.encode(entry.value) };
    }
    return saved;
  }

  decodeEntries(saved: SavedEntries): void {
    for (const [path, entry] of Object.entries(saved)) {
      this.entries.set(path, { stamp: entry.stamp, value: this.codec.decode(entry.value) });
    }
  }

  clearEntries(): void {
    this.entries.clear();
  }
}
