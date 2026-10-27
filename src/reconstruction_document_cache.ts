// Opt-in disk persistence for BuiltReconstruction; avoids costly rebuilds after server respawn.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import type { BuiltReconstruction } from "./reconstruction_json.ts";

// Bump on persisted-shape changes; mismatched versions are treated as cache misses.
const SCHEMA_VERSION = 3;   // 3: lineVerdicts gained source (task 160); 2: scriptRuns (task 67)

// Marker key for serialized domain objects; no real field shares this name.
const DOMAIN_TAG = "__domain";

// Domain class tags for disk-cache serialization only; not part of the wire vocabulary.
enum DomainType {
  path = "Path",
  uuid = "Uuid",
  date = "Date",
}

type TaggedDomainValue = { [DOMAIN_TAG]: DomainType; value: string | number };

// Uses holder `this[key]` to read original class before toJSON flattens it; must be non-arrow.
function encodeDomainValue(this:Record<string, unknown>, key: string, value: unknown): unknown {
  const original = this[key];
  if (original instanceof Path) {
    return { [DOMAIN_TAG]: DomainType.path, value: original.value };
  }
  if (original instanceof Uuid) {
    return { [DOMAIN_TAG]: DomainType.uuid, value: original.value };
  }
  if (original instanceof Date) {
    return { [DOMAIN_TAG]: DomainType.date, value: original.getTime() };
  }
  return value;
}

function isTaggedDomainValue(value: unknown): value is TaggedDomainValue {
  return typeof value === "object" && value !== null && DOMAIN_TAG in value;
}

// Reviver rebuilds tagged leaves into domain classes (children revive before parents).
function decodeDomainValue(_key: string, value: unknown): unknown {
  const isTagged = isTaggedDomainValue(value);
  if (!isTagged) {
    return value;
  }
  if (value[DOMAIN_TAG] === DomainType.path) {
    return new Path(value.value as string);
  }
  if (value[DOMAIN_TAG] === DomainType.uuid) {
    return new Uuid(value.value as string);
  }
  if (value[DOMAIN_TAG] === DomainType.date) {
    return new Date(value.value as number);
  }
  return value;
}

// The pure serialize/hydrate core — tested directly, and reused by the disk read/write below.
export function encodeBuild(built: BuiltReconstruction): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, build: built }, encodeDomainValue);
}

// undefined when the persisted shape predates the current SCHEMA_VERSION (treated as a cache miss).
export function parseBuild(text: string): BuiltReconstruction | undefined {
  const parsed = JSON.parse(text, decodeDomainValue) as { schemaVersion: number; build: BuiltReconstruction };
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return undefined;
  }
  return parsed.build;
}

// Cap on persisted cache files; exported so eviction tests reference it directly.
// ponytail: coarse mtime-ordered eviction, not true LRU; raise the cap or track recency in memory if a dev keeps more live projects warm than this at once.
export const DOCUMENT_CACHE_CAPACITY = 4;

// undefined = memory-only (CLI + tests). Only viewer_server.ts sets a directory.
let cacheDirectory: Path | undefined;

export function setDocumentCachePersistence(directory: Path | undefined): void {
  cacheDirectory = directory;
}

// Wipe cache directory so the next run rebuilds from scratch.
export function resetDocumentCacheOnDisk(directory: Path): void {
  rmSync(directory.toString(), { recursive: true, force: true });
}

// One collision-safe filename per cacheKey.
function getCacheFilePath(directory: Path, cacheKey: string): string {
  const hasher = createHash("sha256");
  return join(directory.toString(), `${hasher.update(cacheKey).digest("hex")}.json`);
}

export function readDocumentFromDiskCache(cacheKey: string): BuiltReconstruction | undefined {
  if (cacheDirectory === undefined) {
    return undefined;
  }
  const filePath = getCacheFilePath(cacheDirectory, cacheKey);
  const fileExists = existsSync(filePath);
  if (!fileExists) {
    return undefined;
  }
  try {
    return parseBuild(readFileSync(filePath, "utf8"));
  }
  catch (error) {
    // A corrupt cache file must not kill a request — log once and rebuild.
    console.error(`document cache unreadable, rebuilding: ${String(error)}`);
    return undefined;
  }
}

export function writeDocumentToDiskCache(cacheKey: string, built: BuiltReconstruction): void {
  if (cacheDirectory === undefined) {
    return;
  }
  try {
    mkdirSync(cacheDirectory.toString(), { recursive: true });
    writeFileSync(getCacheFilePath(cacheDirectory, cacheKey), encodeBuild(built));
    removeOldestBeyondCapacity(cacheDirectory);
  }
  catch (error) {
    // Persistence failure is tolerable; losing the response is not.
    console.error(`document cache not persisted: ${String(error)}`);
  }
}

// Evict oldest files by mtime when count exceeds DOCUMENT_CACHE_CAPACITY.
function compareByModifiedTime(a: { mtimeMs: number }, b: { mtimeMs: number }): number {
  return a.mtimeMs - b.mtimeMs;
}

function removeOldestBeyondCapacity(directory: Path): void {
  const oldestFirst: { name: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(directory.toString())) {
    const isCacheFile = name.endsWith(".json");
    if (isCacheFile) {
      oldestFirst.push({ name, mtimeMs: statSync(join(directory.toString(), name)).mtimeMs });
    }
  }
  oldestFirst.sort(compareByModifiedTime);
  const excessCount = Math.max(0, oldestFirst.length - DOCUMENT_CACHE_CAPACITY);
  for (const { name } of oldestFirst.slice(0, excessCount)) {
    rmSync(join(directory.toString(), name), { force: true });
    console.error(`document cache evicted ${name} (capacity ${DOCUMENT_CACHE_CAPACITY})`);
  }
}

