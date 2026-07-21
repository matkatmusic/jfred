// Item 79: opt-in disk persistence for the viewer's builtDocumentCache. A server respawn otherwise
// re-runs a measured ~468 s / 87 MB reconstruction because the in-memory cache is gone. Persisting
// each BuiltReconstruction ({ document, stepFileHistories }) — hydrated back into real domain objects
// on read — lets every route (timeline, range-patch, step-files, diff) read from disk in sub-second
// time after a respawn. Opt-in exactly like item 11's sandbox memo: only viewer_server.ts configures a
// directory; the CLI + tests leave it undefined and stay memory-only.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import type { BuiltReconstruction } from "./reconstruction_json.ts";

// Bump on any change to the persisted shape OR the tag format below; files carrying a different
// version are ignored (a cache miss) and overwritten by the next rebuild (the cacheKey, hence the
// filename, is unchanged), so a shape change can never deserialize into corruption.
const SCHEMA_VERSION = 3;   // 3: lineVerdicts gained source (task 160); 2: scriptRuns (task 67)

// The wrapper key that marks a serialized domain object. No real persisted field is named this, so a
// revived object can never be a false positive.
const DOMAIN_TAG = "__domain";

// Which domain class a tagged value rebuilds into. Local to this module — a disk-cache detail, never
// part of the JSONL wire vocabulary (structures/vocabulary.ts), so it does not belong there.
enum DomainType {
    path = "Path",
    uuid = "Uuid",
    date = "Date",
}

type TaggedDomainValue = { [DOMAIN_TAG]: DomainType; value: string | number };

// JSON.stringify runs a value's toJSON() BEFORE handing the result to the replacer, so by the time a
// plain replacer sees a Path/Uuid/Date the value is already a bare string and its class is lost. We
// reach PAST toJSON through the holder: `this[key]` is the ORIGINAL object, before toJSON flattened it,
// so we can test its class and tag it. This is exactly why a value-only replacer cannot work (the
// item 79 design note). Non-arrow function so `this` binds to the holder object/array.
function tagDomainValue(this: Record<string, unknown>, key: string, value: unknown): unknown {
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

// The JSON reviver runs children before parents, so a tagged leaf is a real domain object before the
// object containing it is handed up. Rebuilds the class the tag names.
function reviveDomainValue(_key: string, value: unknown): unknown {
    if (!isTaggedDomainValue(value)) {
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
export function serializeBuild(built: BuiltReconstruction): string {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, build: built }, tagDomainValue);
}

// undefined when the persisted shape predates the current SCHEMA_VERSION (treated as a cache miss).
export function hydrateBuild(text: string): BuiltReconstruction | undefined {
    const parsed = JSON.parse(text, reviveDomainValue) as { schemaVersion: number; build: BuiltReconstruction };
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
        return undefined;
    }
    return parsed.build;
}

// Each built document is ~87 MB on the large project; 4 files ≈ 350 MB — enough for a few
// (project, consent, transcript-state) combinations resident without unbounded disk growth. Exported
// so the eviction test references it instead of a magic number, and so it survives in-place tuning.
// ponytail: coarse mtime-ordered eviction, not true LRU; raise the cap or track recency in memory if a
// dev keeps more live projects warm than this at once.
export const DOCUMENT_CACHE_CAPACITY = 4;

// undefined = memory-only (CLI + tests). Only viewer_server.ts sets a directory.
let cacheDirectory: Path | undefined;

export function configureDocumentCachePersistence(directory: Path | undefined): void {
    cacheDirectory = directory;
}

// Delete the whole cache directory so the next run starts cold. force = no error if absent. The server
// calls this before configure when launched with --resetDocumentCache.
export function resetDocumentCacheOnDisk(directory: Path): void {
    rmSync(directory.toString(), { recursive: true, force: true });
}

// One collision-safe filename per cacheKey.
function cacheFilePath(directory: Path, cacheKey: string): string {
    const hash = createHash("sha256").update(cacheKey).digest("hex");
    return join(directory.toString(), `${hash}.json`);
}

export function readDocumentFromDiskCache(cacheKey: string): BuiltReconstruction | undefined {
    if (cacheDirectory === undefined) {
        return undefined;
    }
    const filePath = cacheFilePath(cacheDirectory, cacheKey);
    if (!existsSync(filePath)) {
        return undefined;
    }
    try {
        return hydrateBuild(readFileSync(filePath, "utf8"));
    } catch (error) {
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
        writeFileSync(cacheFilePath(cacheDirectory, cacheKey), serializeBuild(built));
        evictOldestBeyondCapacity(cacheDirectory);
    } catch (error) {
        // Persistence failure is tolerable; losing the response is not.
        console.error(`document cache not persisted: ${String(error)}`);
    }
}

// Keep at most DOCUMENT_CACHE_CAPACITY files; delete the oldest by mtime. The filesystem already
// tracks recency, so no in-memory structure is needed — the newest writes match the transcript states
// currently being viewed; the oldest are dead orphans from since-grown transcripts.
function evictOldestBeyondCapacity(directory: Path): void {
    const files = readdirSync(directory.toString()).filter((name) => name.endsWith(".json"));
    if (files.length <= DOCUMENT_CACHE_CAPACITY) {
        return;
    }
    const oldestFirst = files
        .map((name) => ({ name, mtimeMs: statSync(join(directory.toString(), name)).mtimeMs }))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const { name } of oldestFirst.slice(0, files.length - DOCUMENT_CACHE_CAPACITY)) {
        rmSync(join(directory.toString(), name), { force: true });
        console.error(`document cache evicted ${name} (capacity ${DOCUMENT_CACHE_CAPACITY})`);
    }
}

