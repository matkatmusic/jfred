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
    // Scenario: N distinct spawns below the batch size cause FEWER than N disk writes (the
    // O(N²)-write amplification fix), and the end-of-build flush persists every outcome.
    // Steps:
    // point memo persistence at a temp file (clears the in-memory memo).
    // drive 10 DISTINCT spawns (each a unique script -> no memo hit, one real spawn each).
    // read the on-disk memo BEFORE flushing: batching means it holds fewer than 10 outcomes.
    // flush, then re-read: the file now holds all 10.
    const memoFile = new Path(join(mkdtempSync(join(tmpdir(), "memo-batch-")), "memo.json"));
    configureSandboxMemoPersistence(memoFile);
    try {
        for (let index = 0; index < 10; index += 1) {
            // distinct script text -> distinct input key -> a real spawn (not a memo hit).
            runScriptAgainstState(`open("out.txt", "w").write("run-${index}")\n`, new Map());
        }
        const persistedBeforeFlush = existsSync(memoFile.toString())
            ? Object.keys(JSON.parse(readFileSync(memoFile.toString(), "utf8"))).length
            : 0;
        // Batched (batch size 64): 10 spawns trigger NO mid-run persist, so the file lags behind memory.
        assert.ok(persistedBeforeFlush < 10, `expected <10 persisted before flush, got ${persistedBeforeFlush}`);
        flushSandboxMemoToDisk();
        const persistedAfterFlush = Object.keys(JSON.parse(readFileSync(memoFile.toString(), "utf8"))).length;
        assert.equal(persistedAfterFlush, 10);
    } finally {
        // Restore memory-only mode so sibling tests keep their deterministic spawn counts.
        configureSandboxMemoPersistence(undefined);
    }
});

// The on-disk shape of one persisted memo entry (`post: null` = memoized failure).
type PersistedOutcome = { post: Record<string, string> | null };

test("test_configureSandboxMemoPersistence_writes_new_outcomes_to_disk", () => {
    // Scenario: persistence is configured at an absent file; the first spawned outcome
    // lands in that JSON file.
    // Steps:
    // configure persistence at <tempdir>/memo.json (file does not exist yet).
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const memoFile = join(tempDir, "memo.json");
    try {
        configureSandboxMemoPersistence(new Path(memoFile));
        // run a script unique to this run (temp dir embedded in a comment, so a leaked
        // memo entry from another test can never satisfy the lookup), counting spawns.
        const script = `# ${tempDir}\nopen("out.txt", "w").write("persisted\\n")\n`;
        const spawnLabels = collectSandboxSpawnLabels(() => {
            runScriptAgainstState(script, new Map([["keep.py", "x = 1\n"]]));
        });
        // exactly one sandbox spawn happened.
        assert.equal(spawnLabels.length, 1);
        // persistence is batched now — flush so the single sub-batch outcome reaches disk.
        flushSandboxMemoToDisk();
        // the JSON file now exists, parses, and holds exactly one outcome whose post
        // carries the script-created file's path and content.
        const persisted = JSON.parse(readFileSync(memoFile, "utf8")) as Record<string, PersistedOutcome>;
        const outcomes = Object.values(persisted);
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0]!.post?.["out.txt"], "persisted\n");
    } finally {
        configureSandboxMemoPersistence(undefined);
    }
});

test("test_configureSandboxMemoPersistence_seeds_memo_from_disk", () => {
    // Scenario: configuring persistence at a previously written file seeds the memo from
    // disk, so a run already persisted never spawns again — even across a memo clear.
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const fileA = join(tempDir, "memo-a.json");
    const fileB = join(tempDir, "memo-b.json");
    const script = `# ${tempDir}\nopen("data.txt", "w").write("after\\n")\n`;
    const preState = new Map([["data.txt", "before\n"]]);
    try {
        // Steps:
        // configure at file A (absent) and run once → one spawn, outcome persisted to A.
        configureSandboxMemoPersistence(new Path(fileA));
        let firstResult: Map<string, string> | undefined;
        const firstSpawns = collectSandboxSpawnLabels(() => {
            firstResult = runScriptAgainstState(script, preState);
        });
        assert.equal(firstSpawns.length, 1);
        // flush the batched outcome to file A before switching away (else A stays empty on disk).
        flushSandboxMemoToDisk();
        // configure at a different, absent file B → memo replaced with empty; the same
        // run must spawn again.
        configureSandboxMemoPersistence(new Path(fileB));
        const secondSpawns = collectSandboxSpawnLabels(() => {
            runScriptAgainstState(script, preState);
        });
        assert.equal(secondSpawns.length, 1);
        // configure back at file A → memo seeded from disk; the same run spawns ZERO times
        // and returns the first run's content.
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
    // Scenario: a memoized FAILURE survives the disk round trip — it must stay
    // distinguishable from a cache miss (post: null on disk, 0 spawns after reseed).
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const memoFile = join(tempDir, "memo.json");
    const clearFile = join(tempDir, "memo-clear.json");
    const script = `# ${tempDir}\nraise SystemExit(1)\n`;
    const preState = new Map([["data.txt", "x\n"]]);
    try {
        // Steps:
        // configure at a fresh file; the failing run spawns once and yields undefined.
        configureSandboxMemoPersistence(new Path(memoFile));
        let firstResult: Map<string, string> | undefined;
        const firstSpawns = collectSandboxSpawnLabels(() => {
            firstResult = runScriptAgainstState(script, preState);
        });
        assert.equal(firstSpawns.length, 1);
        assert.equal(firstResult, undefined);
        // batched persistence — flush so the single failure outcome reaches disk.
        flushSandboxMemoToDisk();
        // the file's single persisted outcome records the failure as post: null.
        const persisted = JSON.parse(readFileSync(memoFile, "utf8")) as Record<string, PersistedOutcome>;
        const outcomes = Object.values(persisted);
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0]!.post, null);
        // clear the memo (absent file), then configure back at the written file.
        configureSandboxMemoPersistence(new Path(clearFile));
        configureSandboxMemoPersistence(new Path(memoFile));
        // the failing run again: zero new spawns, result still undefined (a memoized
        // failure, not a miss — the sentinel proves the callback overwrote it).
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
    // Scenario: resetSandboxMemoOnDisk removes a present memo file so the next load starts empty.
    const dir = mkdtempSync(join(tmpdir(), "memo-reset-"));
    const memoFile = join(dir, "memo.json");
    writeFileSync(memoFile, "{}");
    assert.ok(existsSync(memoFile));
    // Verify: after the reset the file is gone.
    resetSandboxMemoOnDisk(new Path(memoFile));
    assert.ok(!existsSync(memoFile));
});

test("test_resetSandboxMemoOnDisk_is_a_noop_when_the_memo_file_is_absent", () => {
    // Scenario: resetSandboxMemoOnDisk on a missing file does not throw (force delete).
    const dir = mkdtempSync(join(tmpdir(), "memo-reset-"));
    const memoFile = join(dir, "absent.json");
    assert.ok(!existsSync(memoFile));
    // Verify: no throw, and the file still does not exist.
    assert.doesNotThrow(() => resetSandboxMemoOnDisk(new Path(memoFile)));
    assert.ok(!existsSync(memoFile));
});
