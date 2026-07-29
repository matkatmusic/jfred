// Run detection lives in reconstruction_script_execution.ts, pre-execution seeding in reconstruction_script_prestate.ts.

import { Path } from "./structures/domain.ts";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { getCachedValueRefreshingRecency, evictLeastRecentlyUsedEntries } from "./cache_lru.ts";
import {
    ReconstructionCounter,
    incrementReconstructionCounter,
} from "./reconstruction_counters.ts";

function readAllFiles(dir: string, base: string = dir): [string, string][] {
    const files: [string, string][] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...readAllFiles(full, base));
        } else if (entry.isFile()) {
            files.push([relative(base, full), readFileSync(full, "utf8")]);
        }
    }
    return files;
}

// The script's first line, capped, so a progress line identifies which run is executing.
function summarizeScriptForProgress(script: string): string {
    const firstLine = script.split("\n", 1)[0] ?? "";
    if (firstLine.length <= 60) {
        return firstLine;
    }
    return `${firstLine.slice(0, 59)}…`;
}

export const PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX = "running script in sandbox";
export const PROGRESS_LABEL_SANDBOX_MEMO_PREFIX = "reusing sandbox result";

// Python bytecode caches are sandbox artifacts no scenario tracks; canonical filter for all callers.
export function isJunkStateKey(key: string): boolean {
    return key.includes("__pycache__") || key.endsWith(".pyc");
}

// A script is deterministic per input, so one spawn suffices; ponytail: outcomes returned by reference, treat post-states read-only.
type SandboxOutcome = { post: Map<string, string> | undefined };
const sandboxOutcomesByInput = new Map<string, SandboxOutcome>();
// Must exceed a project's distinct run count or eviction beats the disk snapshot; ponytail: flat constant, revisit if exceeded.
const SANDBOX_MEMO_CAPACITY = 4096;

// Opt-in (viewer only, keeps CLI/tests deterministic); batches to avoid O(N²) rewrites. ponytail: fixed batch size, a crash re-spawns one batch.
let sandboxMemoFilePath: Path | undefined;
const SANDBOX_MEMO_PERSIST_BATCH_SIZE = 64;
let sandboxSpawnsSinceLastPersist = 0;

// Wire shape of one memo entry on disk: `post: null` records a memoized failure.
type PersistedSandboxOutcome = { post: Record<string, string> | null };

export function configureSandboxMemoPersistence(filePath: Path | undefined): void {
    sandboxMemoFilePath = filePath;
    sandboxOutcomesByInput.clear();
    sandboxSpawnsSinceLastPersist = 0;
    if (filePath === undefined) {
        return;
    }
    loadSandboxMemoFromDisk(filePath);
}

// Call once when a reconstruction completes so the final sub-batch tail of new spawns isn't lost; no-op without a path.
export function flushSandboxMemoToDisk(): void {
    persistSandboxMemoToDisk();
    sandboxSpawnsSinceLastPersist = 0;
}

// Deletes the persisted sandbox memo so --resetSandboxMemo forces a full cold-load reconstruction from scratch.
export function resetSandboxMemoOnDisk(filePath: Path): void {
    rmSync(filePath.toString(), { force: true });
}

// Rehydrate one persisted entry into the in-memory memo (`post: null` = memoized failure).
function restorePersistedOutcomeIntoMemo(inputKey: string, outcome: PersistedSandboxOutcome): void {
    sandboxOutcomesByInput.set(inputKey, {
        post: outcome.post === null ? undefined : new Map(Object.entries(outcome.post)),
    });
}

// Seed the (just-cleared) memo from a previously persisted file; absent file = start empty.
function loadSandboxMemoFromDisk(filePath: Path): void {
    if (!existsSync(filePath.toString())) {
        return;
    }
    try {
        const persisted = JSON.parse(readFileSync(filePath.toString(), "utf8")) as Record<
            string,
            PersistedSandboxOutcome
        >;
        for (const [inputKey, outcome] of Object.entries(persisted)) {
            restorePersistedOutcomeIntoMemo(inputKey, outcome);
        }
    } catch (error) {
        // A corrupt cache file must not kill the server — log once and continue empty.
        console.error(`sandbox memo cache unreadable, starting empty: ${String(error)}`);
    }
}

// Mirror the capped memo to disk (called after set + evict, so the file inherits the 256 cap).
function persistSandboxMemoToDisk(): void {
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
    } catch (error) {
        // Persistence failure is tolerable; losing the reconstruction is not.
        console.error(`sandbox memo cache not persisted: ${String(error)}`);
    }
}

// Hashes the script plus sorted seeded (path, content) pairs, plus cwd since remapping cwd changes the effective script.
function computeSandboxInputKey(script: string, preState: Map<string, string>, recordedCwd?: Path): string {
    const hash = createHash("sha256");
    hash.update(script);
    if (recordedCwd !== undefined) {
        hash.update("\0cwd\0");
        hash.update(recordedCwd.toString());
    }
    const sortedPaths = [...preState.keys()].sort();
    for (const path of sortedPaths) {
        hash.update("\0");
        hash.update(path);
        hash.update("\0");
        hash.update(preState.get(path)!);
    }
    return hash.digest("hex");
}

export function runScriptAgainstState(
    script: string,
    preState: Map<string, string>,
    sourceLabel = "",
    recordedCwd?: Path,
): Map<string, string> | undefined {
    const inputKey = computeSandboxInputKey(script, preState, recordedCwd);
    const memoizedOutcome = getCachedValueRefreshingRecency(sandboxOutcomesByInput, inputKey);
    if (memoizedOutcome !== undefined) {
        incrementReconstructionCounter(ReconstructionCounter.sandboxMemoHits);
        reportReconstructionProgress(
            `${PROGRESS_LABEL_SANDBOX_MEMO_PREFIX}${sourceLabel}: ${summarizeScriptForProgress(script)}`,
        );
        return memoizedOutcome.post;
    }
    reportReconstructionProgress(
        `${PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX} (${preState.size} seeded files)${sourceLabel}: ${summarizeScriptForProgress(script)}`,
    );
    incrementReconstructionCounter(ReconstructionCounter.sandboxSpawns);
    const post = spawnSandboxRun(script, preState, recordedCwd);
    sandboxOutcomesByInput.set(inputKey, { post });
    evictLeastRecentlyUsedEntries(sandboxOutcomesByInput, SANDBOX_MEMO_CAPACITY);
    // Persist per batch, not per spawn, since a full rewrite is O(N²); flushSandboxMemoToDisk() catches the final tail at build end.
    sandboxSpawnsSinceLastPersist += 1;
    if (sandboxSpawnsSinceLastPersist >= SANDBOX_MEMO_PERSIST_BATCH_SIZE) {
        persistSandboxMemoToDisk();
        sandboxSpawnsSinceLastPersist = 0;
    }
    return post;
}

// Seeds a temp dir, runs python3, reads back the tree; remaps a hardcoded cwd so scripts can't escape the sandbox.
function spawnSandboxRun(
    script: string,
    preState: Map<string, string>,
    recordedCwd?: Path,
): Map<string, string> | undefined {
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-"));
    try {
        for (const [relativePath, content] of preState) {
            const dest = join(tempDir, relativePath);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, content);
        }
        const remappedScript =
            recordedCwd === undefined ? script : script.replaceAll(recordedCwd.toString(), tempDir);
        writeFileSync(join(tempDir, "__script__.py"), remappedScript);
        execSync("python3 __script__.py", { cwd: tempDir, timeout: 5000, stdio: "pipe" });
        const result = new Map<string, string>();
        for (const [relativePath, content] of readAllFiles(tempDir)) {
            if (relativePath === "__script__.py") continue;
            result.set(relativePath, content);
        }
        return result;
    } catch {
        return undefined;
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
