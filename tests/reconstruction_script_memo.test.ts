import { test } from "node:test";
import assert from "node:assert/strict";
import {
    configureSandboxMemoPersistence,
    flushSandboxMemoToDisk,
    resetSandboxMemoOnDisk,
    runScriptAgainstState,
} from "../src/reconstruction_script_sandbox.ts";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path } from "../src/structures/domain.ts";
import { collectSandboxSpawnLabels } from "./script-execution-test-helpers.ts";

test("test_sandboxMemoDiskWrite_is_batched_and_flushed_at_end", () => {
    // N distinct spawns below the batch size cause FEWER than N disk writes (the O(N²)-write
    // amplification fix), and the end-of-build flush persists every outcome.
    const memoFile = new Path(join(mkdtempSync(join(tmpdir(), "memo-batch-")), "memo.json"));
    configureSandboxMemoPersistence(memoFile);
    try {
        for (let index = 0; index < 10; index += 1) {
            // Distinct script text means a distinct input key, so this really spawns.
            runScriptAgainstState(`open("out.txt", "w").write("run-${index}")\n`, new Map());
        }
        const persistedBeforeFlush = existsSync(memoFile.toString())
            ? Object.keys(JSON.parse(readFileSync(memoFile.toString(), "utf8"))).length
            : 0;
        // Batch size is 64, so 10 spawns trigger no mid-run persist and the file lags behind memory.
        assert.ok(persistedBeforeFlush < 10, `expected <10 persisted before flush, got ${persistedBeforeFlush}`);
        flushSandboxMemoToDisk();
        const persistedAfterFlush = Object.keys(JSON.parse(readFileSync(memoFile.toString(), "utf8"))).length;
        assert.equal(persistedAfterFlush, 10);
    } finally {
        // Memory-only mode keeps sibling tests' spawn counts deterministic.
        configureSandboxMemoPersistence(undefined);
    }
});

// `post: null` means a memoized failure.
type PersistedOutcome = { post: Record<string, string> | null };

test("test_configureSandboxMemoPersistence_writes_new_outcomes_to_disk", () => {
    // Persistence configured at an absent file: the first spawned outcome lands in that JSON file.
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const memoFile = join(tempDir, "memo.json");
    try {
        configureSandboxMemoPersistence(new Path(memoFile));
        // The temp dir is embedded in the script so a leaked memo entry cannot satisfy the lookup.
        const script = `# ${tempDir}\nopen("out.txt", "w").write("persisted\\n")\n`;
        const spawnLabels = collectSandboxSpawnLabels(() => {
            runScriptAgainstState(script, new Map([["keep.py", "x = 1\n"]]));
        });
        assert.equal(spawnLabels.length, 1);
        // Persistence is batched, so flush before reading a sub-batch outcome off disk.
        flushSandboxMemoToDisk();
        const persisted = JSON.parse(readFileSync(memoFile, "utf8")) as Record<string, PersistedOutcome>;
        const outcomes = Object.values(persisted);
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0]!.post?.["out.txt"], "persisted\n");
    } finally {
        configureSandboxMemoPersistence(undefined);
    }
});

test("test_configureSandboxMemoPersistence_seeds_memo_from_disk", () => {
    // Configuring at a previously written file seeds the memo from disk, so an already-persisted
    // run never spawns again — even across a memo clear.
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const fileA = join(tempDir, "memo-a.json");
    const fileB = join(tempDir, "memo-b.json");
    const script = `# ${tempDir}\nopen("data.txt", "w").write("after\\n")\n`;
    const preState = new Map([["data.txt", "before\n"]]);
    try {
        configureSandboxMemoPersistence(new Path(fileA));
        let firstResult: Map<string, string> | undefined;
        const firstSpawns = collectSandboxSpawnLabels(() => {
            firstResult = runScriptAgainstState(script, preState);
        });
        assert.equal(firstSpawns.length, 1);
        // Flush before switching away, else file A stays empty on disk.
        flushSandboxMemoToDisk();
        // An absent file B replaces the memo with an empty one, so the same run must spawn again.
        configureSandboxMemoPersistence(new Path(fileB));
        const secondSpawns = collectSandboxSpawnLabels(() => {
            runScriptAgainstState(script, preState);
        });
        assert.equal(secondSpawns.length, 1);
        // Back at file A the memo is seeded from disk, so the run spawns ZERO times.
        configureSandboxMemoPersistence(new Path(fileA));
        let seededResult: Map<string, string> | undefined;
        const thirdSpawns = collectSandboxSpawnLabels(() => {
            seededResult = runScriptAgainstState(script, preState);
        });
        assert.equal(thirdSpawns.length, 0);
        assert.deepEqual(seededResult, firstResult);
    } finally {
        configureSandboxMemoPersistence(undefined);
    }
});

test("test_persisted_failure_outcomes_round_trip", () => {
    // A memoized FAILURE must survive the round trip and stay distinguishable from a cache miss.
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const memoFile = join(tempDir, "memo.json");
    const clearFile = join(tempDir, "memo-clear.json");
    const script = `# ${tempDir}\nraise SystemExit(1)\n`;
    const preState = new Map([["data.txt", "x\n"]]);
    try {
        configureSandboxMemoPersistence(new Path(memoFile));
        let firstResult: Map<string, string> | undefined;
        const firstSpawns = collectSandboxSpawnLabels(() => {
            firstResult = runScriptAgainstState(script, preState);
        });
        assert.equal(firstSpawns.length, 1);
        assert.equal(firstResult, undefined);
        // Persistence is batched, so flush before reading the failure outcome off disk.
        flushSandboxMemoToDisk();
        const persisted = JSON.parse(readFileSync(memoFile, "utf8")) as Record<string, PersistedOutcome>;
        const outcomes = Object.values(persisted);
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0]!.post, null);
        // Clear via an absent file, then configure back at the written one.
        configureSandboxMemoPersistence(new Path(clearFile));
        configureSandboxMemoPersistence(new Path(memoFile));
        // The non-undefined sentinel proves the callback overwrote it, so undefined means a
        // memoized failure rather than a miss.
        let seededResult: Map<string, string> | undefined = new Map();
        const secondSpawns = collectSandboxSpawnLabels(() => {
            seededResult = runScriptAgainstState(script, preState);
        });
        assert.equal(secondSpawns.length, 0);
        assert.equal(seededResult, undefined);
    } finally {
        configureSandboxMemoPersistence(undefined);
    }
});

test("test_resetSandboxMemoOnDisk_deletes_an_existing_memo_file", () => {
    // Removing the file is what makes the next load start empty.
    const dir = mkdtempSync(join(tmpdir(), "memo-reset-"));
    const memoFile = join(dir, "memo.json");
    writeFileSync(memoFile, "{}");
    assert.ok(existsSync(memoFile));
    resetSandboxMemoOnDisk(new Path(memoFile));
    assert.ok(!existsSync(memoFile));
});

test("test_resetSandboxMemoOnDisk_is_a_noop_when_the_memo_file_is_absent", () => {
    // A missing file must not throw: the delete is forced.
    const dir = mkdtempSync(join(tmpdir(), "memo-reset-"));
    const memoFile = join(dir, "absent.json");
    assert.ok(!existsSync(memoFile));
    assert.doesNotThrow(() => resetSandboxMemoOnDisk(new Path(memoFile)));
    assert.ok(!existsSync(memoFile));
});
