// Run detection lives in reconstruction_script_execution.ts, pre-execution seeding in
// reconstruction_script_prestate.ts.

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

// A script is a deterministic transform of its seeded files, so one spawn per distinct input
// suffices. The wrapper keeps a memoized failure (`post: undefined`) distinct from a cache miss.
// ponytail: outcomes are returned by reference — every caller treats post-states as read-only.
type SandboxOutcome = { post: Map<string, string> | undefined };
const sandboxOutcomesByInput = new Map<string, SandboxOutcome>();
// Must exceed a project's distinct run count, else eviction beats the disk snapshot and every cold
// process re-spawns. ponytail: flat constant — revisit if a project exceeds it.
const SANDBOX_MEMO_CAPACITY = 4096;

// Opt-in: only the viewer server configures a path, keeping CLI/test spawn counts deterministic.
// Persisting rewrites the WHOLE memo, so batching avoids O(N²) over a cold load.
// ponytail: fixed batch size; a crash loses at most one batch, which the next load re-spawns.
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

// Persist the memo unconditionally and reset the batch counter — call once when a reconstruction
// completes so the final (sub-batch) tail of new spawns is never lost. No-op without a configured path.
export function flushSandboxMemoToDisk(): void {
    persistSandboxMemoToDisk();
    sandboxSpawnsSinceLastPersist = 0;
}

// Delete the persisted sandbox memo so the next run starts with an empty cache (force = no error if
// absent). The server calls this before configureSandboxMemoPersistence when launched with
// --resetSandboxMemo, to watch a full cold load reconstruct everything from scratch.
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

// One collision-safe key per distinct sandbox input: the script plus every seeded (path,
// content) pair in sorted-path order, NUL-separated, hashed. The recorded cwd participates
// because it changes the effective script (its literal gets remapped to the sandbox dir) —
// and its inclusion invalidates memoized failures persisted before the remap existed.
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
    // Persist per batch, not per spawn: the whole-memo rewrite is O(N²) if done every time.
    // flushSandboxMemoToDisk() at end of build catches the final sub-batch tail.
    sandboxSpawnsSinceLastPersist += 1;
    if (sandboxSpawnsSinceLastPersist >= SANDBOX_MEMO_PERSIST_BATCH_SIZE) {
        persistSandboxMemoToDisk();
        sandboxSpawnsSinceLastPersist = 0;
    }
    return post;
}

// The sandbox execution itself, extracted verbatim from the pre-memo body: seed a temp dir,
// run python3, read back the resulting tree (undefined on any script failure).
// A script that hardcodes its RECORDED cwd as an absolute literal would escape the sandbox and
// touch (or mutate!) the real directory — so the recorded cwd, when known, is remapped to the
// sandbox dir in the script text before it is written.
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
