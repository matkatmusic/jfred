// Memo of sandbox outcomes per input key, optionally persisted to disk by the viewer.

import { Path } from "./structures/domain.ts";
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { getCachedValueRefreshingRecency, removeLeastRecentlyUsedEntries } from "./cache_lru.ts";

// One spawn per input suffices; ponytail: outcomes returned by reference, treat post-states read-only.
export type SandboxOutcome = { post: Map<string, string> | undefined };
const sandboxOutcomesByInput = new Map<string, SandboxOutcome>();
// Must exceed a project's distinct run count; ponytail: flat constant, revisit if exceeded.
const SANDBOX_MEMO_CAPACITY = 4096;

// Opt-in (viewer only) and batched to avoid O(N²) rewrites; ponytail: a crash re-spawns one batch.
let sandboxMemoFilePath: Path | undefined;
const SANDBOX_MEMO_PERSIST_BATCH_SIZE = 64;
let sandboxSpawnsSinceLastPersist = 0;

// Wire shape of one memo entry on disk: `post: null` records a memoized failure.
type PersistedSandboxOutcome = { post: Record<string, string> | null };

export function getMemoizedSandboxOutcome(inputKey: string): SandboxOutcome | undefined {
  return getCachedValueRefreshingRecency(sandboxOutcomesByInput, inputKey);
}

export function storeSandboxOutcome(inputKey: string, post: Map<string, string> | undefined): void {
  sandboxOutcomesByInput.set(inputKey, { post });
  removeLeastRecentlyUsedEntries(sandboxOutcomesByInput, SANDBOX_MEMO_CAPACITY);
  // Persist per batch, not per spawn; writePendingSandboxMemoToDisk() catches the final tail.
  sandboxSpawnsSinceLastPersist += 1;
  if (sandboxSpawnsSinceLastPersist >= SANDBOX_MEMO_PERSIST_BATCH_SIZE) {
    saveSandboxMemoToDisk();
    sandboxSpawnsSinceLastPersist = 0;
  }
}

export function setSandboxMemoPersistence(filePath: Path | undefined): void {
  sandboxMemoFilePath = filePath;
  sandboxOutcomesByInput.clear();
  sandboxSpawnsSinceLastPersist = 0;
  if (filePath === undefined) {
    return;
  }
  loadSandboxMemoFromDisk(filePath);
}

// Call once when a reconstruction completes so the final sub-batch tail isn't lost.
export function writePendingSandboxMemoToDisk(): void {
  saveSandboxMemoToDisk();
  sandboxSpawnsSinceLastPersist = 0;
}

// Deletes the persisted memo so --resetSandboxMemo forces a full cold-load reconstruction.
export function resetSandboxMemoOnDisk(filePath: Path): void {
  rmSync(filePath.toString(), { force: true });
}

// Rehydrate one persisted entry into the in-memory memo (`post: null` = memoized failure).
function loadPersistedOutcomeIntoMemo(inputKey: string, outcome: PersistedSandboxOutcome): void {
  sandboxOutcomesByInput.set(inputKey, {
    post: outcome.post === null ? undefined : new Map(Object.entries(outcome.post)),
  });
}

// Seed the (just-cleared) memo from a previously persisted file; absent file = start empty.
function loadSandboxMemoFromDisk(filePath: Path): void {
  const memoFileExists = existsSync(filePath.toString());
  if (!memoFileExists) {
    return;
  }
  try {
    const persisted = JSON.parse(readFileSync(filePath.toString(), "utf8")) as Record<
      string,
      PersistedSandboxOutcome
    >;
    for (const [inputKey, outcome] of Object.entries(persisted)) {
      loadPersistedOutcomeIntoMemo(inputKey, outcome);
    }
  }
  catch (error) {
    // A corrupt cache file must not kill the server: log once and continue empty.
    console.error(`sandbox memo cache unreadable, starting empty: ${String(error)}`);
  }
}

// Mirror the capped memo to disk (called after set + evict).
function saveSandboxMemoToDisk(): void {
  if (sandboxMemoFilePath === undefined) {
    return;
  }
  try {
    const persisted: Record<string, PersistedSandboxOutcome> = {};
    for (const [inputKey, outcome] of sandboxOutcomesByInput) {
      persisted[inputKey] = { post: outcome.post === undefined ? null : Object.fromEntries(outcome.post) };
    }
    mkdirSync(dirname(sandboxMemoFilePath.toString()), { recursive: true });
    writeFileSync(sandboxMemoFilePath.toString(), JSON.stringify(persisted));
  }
  catch (error) {
    // Persistence failure is tolerable; losing the reconstruction is not.
    console.error(`sandbox memo cache not persisted: ${String(error)}`);
  }
}
