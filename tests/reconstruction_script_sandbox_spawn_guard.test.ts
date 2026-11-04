import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSandboxInputKey, executeScriptAgainstState } from "../src/reconstruction_script_sandbox.ts";
import {
    getMemoizedSandboxOutcome,
    setSandboxMemoPersistence,
    storeSandboxOutcome,
} from "../src/reconstruction_script_sandbox_memo.ts";
import {
    EarlierRunNotSavedError,
    assertSpawnAllowed,
    runCollectingEarlierRuns,
    runWithoutSpawning,
} from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import { getReconstructionCounterSnapshot, resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { WireNeedState } from "../webapp/layer1-wire-script-results.ts";

const PRE_STATE = new Map([["a.txt", "1\n"]]);

function resetSandboxState(): void {
    setSandboxMemoPersistence(undefined);
    resetReconstructionCounters();
}

function storeOutcomeFor(script: string, post: Map<string, string> | undefined): void {
    storeSandboxOutcome(computeSandboxInputKey(script, PRE_STATE), post);
}

test("test_runWithoutSpawning_throws_EarlierRunNotSavedError_naming_the_run_on_a_miss", () => {
    resetSandboxState();
    const script = "print('miss')\n";
    assert.throws(
        () => runWithoutSpawning(new Set(), () => executeScriptAgainstState(script, PRE_STATE, " [run A]")),
        (error: Error) => error instanceof EarlierRunNotSavedError && error.message.includes(" [run A]"),
    );
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey(script, PRE_STATE)), undefined);
});

test("test_runWithoutSpawning_returns_undefined_for_a_never_run_script_and_stores_nothing", () => {
    resetSandboxState();
    const script = "print('never')\n";
    const post = runWithoutSpawning(new Set([script]), () => executeScriptAgainstState(script, PRE_STATE, " [run N]"));
    assert.equal(post, undefined);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey(script, PRE_STATE)), undefined);
});

test("test_runWithoutSpawning_serves_a_memo_hit", () => {
    resetSandboxState();
    const script = "print('hit')\n";
    const saved = new Map([["a.txt", "2\n"]]);
    storeOutcomeFor(script, saved);
    const post = runWithoutSpawning(new Set(), () => executeScriptAgainstState(script, PRE_STATE, " [run H]"));
    assert.equal(post, saved);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getReconstructionCounterSnapshot().sandboxMemoHits, 1);
});

test("test_runWithoutSpawning_is_off_again_after_a_throw", () => {
    resetSandboxState();
    assert.throws(() => runWithoutSpawning(new Set(), () => executeScriptAgainstState("pass\n", PRE_STATE)));
    assert.equal(assertSpawnAllowed("pass\n", ""), true);
});

test("test_runCollectingEarlierRuns_records_one_entry_per_miss_and_one_per_failed_memo_hit", () => {
    resetSandboxState();
    storeOutcomeFor("crashed\n", undefined);
    storeOutcomeFor("saved\n", new Map());
    const collected: (Map<string, string> | undefined)[] = [];
    const reports = runCollectingEarlierRuns(new Set(["never\n"]), () => {
        collected.push(executeScriptAgainstState("missing\n", PRE_STATE, " [run M]"));
        collected.push(executeScriptAgainstState("crashed\n", PRE_STATE, " [run C]"));
        collected.push(executeScriptAgainstState("saved\n", PRE_STATE, " [run S]"));
        collected.push(executeScriptAgainstState("never\n", PRE_STATE, " [run N]"));
        collected.push(executeScriptAgainstState("missing\n", PRE_STATE, " [run M2]"));
    });
    assert.deepEqual(reports, [
        { script: "missing\n", label: " [run M]", state: WireNeedState.unreplayed },
        { script: "crashed\n", label: " [run C]", state: WireNeedState.replayFailed },
        { script: "missing\n", label: " [run M2]", state: WireNeedState.unreplayed },
    ]);
    assert.equal(collected[0], undefined);
    assert.equal(collected[3], undefined);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey("missing\n", PRE_STATE)), undefined);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey("never\n", PRE_STATE)), undefined);
});

test("test_runCollectingEarlierRuns_is_off_again_after_a_throw", () => {
    resetSandboxState();
    assert.throws(() => runCollectingEarlierRuns(new Set(), () => {
        throw new Error("boom");
    }), /boom/);
    assert.equal(assertSpawnAllowed("pass\n", ""), true);
});

test("test_runWithoutSpawning_restores_the_outer_mode_after_a_nested_call", () => {
    resetSandboxState();
    const reports = runCollectingEarlierRuns(new Set(), () => {
        runWithoutSpawning(new Set(["x\n"]), () => assertSpawnAllowed("x\n", ""));
        assertSpawnAllowed("outer\n", " [outer]");
    });
    assert.deepEqual(reports, [{ script: "outer\n", label: " [outer]", state: WireNeedState.unreplayed }]);
});
