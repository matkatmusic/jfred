// Saved replay results per session file: kept in memory, saved to one disk file, wiped by Clear.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireFileChange, WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import { createResult } from "../src/layer1_run_result.ts";
import {
    clearRunResultStore,
    listSavedRunResults,
    setRunResultStorePersistence,
    storeRunResultForSession,
} from "../src/layer1_run_result_store.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

after(() => {
    clearRunResultStore();
});

function createStoreFixture(): { sessionFile: Path; storeFile: Path } {
    const folder = mkdtempSync(join(tmpdir(), "run-result-store-"));
    const sessionFile = join(folder, "session.jsonl");
    writeFileSync(sessionFile, "{}\n");
    return { sessionFile: new Path(sessionFile), storeFile: new Path(join(folder, "results.json")) };
}

function createReplayedFixtureResult(toolUseId: string) {
    const files = [{ path: "a.txt", change: WireFileChange.changed, confidence: WireConfidence.verified }];
    return createResult(new Uuid(toolUseId), WireRunOutcome.replayed, { files, confidence: WireConfidence.verified });
}

test("test_storeRunResultForSession_then_listSavedRunResults_returns_it", () => {
    // Scenario: a stored result comes back for the same session file, with Path and Uuid types.
    const { sessionFile, storeFile } = createStoreFixture();
    setRunResultStorePersistence(storeFile);
    // Store one replayed result.
    storeRunResultForSession(sessionFile, createReplayedFixtureResult("toolu_a"));
    // The list holds that result, with a Uuid id and a Path file path.
    const results = listSavedRunResults(sessionFile);
    assert.equal(results.length, 1);
    assert.ok(results[0]!.toolUseId instanceof Uuid);
    assert.equal(results[0]!.toolUseId.toString(), "toolu_a");
    assert.ok(results[0]!.files[0]!.path instanceof Path);
    assert.equal(results[0]!.files[0]!.path.toString(), "a.txt");
    assert.equal(results[0]!.outcome, WireRunOutcome.replayed);
});

test("test_storeRunResultForSession_keeps_the_newest_result_per_tool_use_id", () => {
    // Scenario: a second replay of the same run replaces the first result.
    const { sessionFile, storeFile } = createStoreFixture();
    setRunResultStorePersistence(storeFile);
    // Store a replayed result, then a replay-failed result for the same tool use id.
    storeRunResultForSession(sessionFile, createReplayedFixtureResult("toolu_a"));
    storeRunResultForSession(sessionFile, createResult(new Uuid("toolu_a"), WireRunOutcome.replayFailed));
    // Only the newest result is listed.
    const results = listSavedRunResults(sessionFile);
    assert.deepEqual(results.map((result) => result.outcome), [WireRunOutcome.replayFailed]);
});

test("test_listSavedRunResults_is_empty_after_the_session_file_changes", () => {
    // Scenario: the stamp is path, change time and size; a changed session file voids its saved results.
    const { sessionFile, storeFile } = createStoreFixture();
    setRunResultStorePersistence(storeFile);
    // Store a result, then change the session file's size and change time.
    storeRunResultForSession(sessionFile, createReplayedFixtureResult("toolu_a"));
    writeFileSync(sessionFile.toString(), "{}\n{}\n");
    utimesSync(sessionFile.toString(), new Date("2030-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
    // The list is empty.
    assert.deepEqual(listSavedRunResults(sessionFile), []);
});

test("test_clearRunResultStore_deletes_the_disk_file", () => {
    // Scenario: Clear wipes memory and the disk file.
    const { sessionFile, storeFile } = createStoreFixture();
    setRunResultStorePersistence(storeFile);
    // Store a result; the disk file exists at once.
    storeRunResultForSession(sessionFile, createReplayedFixtureResult("toolu_a"));
    assert.ok(existsSync(storeFile.toString()));
    // Clear: the disk file is gone and the list is empty.
    clearRunResultStore();
    assert.equal(existsSync(storeFile.toString()), false);
    assert.deepEqual(listSavedRunResults(sessionFile), []);
});

test("test_saved_results_survive_a_new_load_from_disk", () => {
    // Scenario: a server restart loads the saved results again, with Path and Uuid types.
    const { sessionFile, storeFile } = createStoreFixture();
    setRunResultStorePersistence(storeFile);
    // Store a result, then set the same file again: memory empties and the disk file loads.
    storeRunResultForSession(sessionFile, createReplayedFixtureResult("toolu_a"));
    setRunResultStorePersistence(storeFile);
    // The result is back, equal to the stored one.
    const results = listSavedRunResults(sessionFile);
    assert.equal(results.length, 1);
    assert.ok(results[0]!.toolUseId instanceof Uuid);
    assert.ok(results[0]!.files[0]!.path instanceof Path);
    assert.equal(results[0]!.files[0]!.confidence, WireConfidence.verified);
    assert.equal(results[0]!.confidence, WireConfidence.verified);
});
