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
    collectEarlierRuns,
    executeSkippingMisses,
    executeWithoutSpawning,
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

test("test_executeWithoutSpawning_throws_EarlierRunNotSavedError_naming_the_run_on_a_miss", () => {
    resetSandboxState();
    const script = "print('miss')\n";
    assert.throws(
        () => executeWithoutSpawning(new Set(), () => executeScriptAgainstState(script, PRE_STATE, " [run A]")),
        (error: Error) => error instanceof EarlierRunNotSavedError && error.message.includes(" [run A]"),
    );
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey(script, PRE_STATE)), undefined);
});

test("test_executeWithoutSpawning_returns_undefined_for_a_never_run_script_and_stores_nothing", () => {
    resetSandboxState();
    const script = "print('never')\n";
    const post = executeWithoutSpawning(new Set([script]), () => executeScriptAgainstState(script, PRE_STATE, " [run N]"));
    assert.equal(post, undefined);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey(script, PRE_STATE)), undefined);
});

test("test_executeWithoutSpawning_serves_a_memo_hit", () => {
    resetSandboxState();
    const script = "print('hit')\n";
    const saved = new Map([["a.txt", "2\n"]]);
    storeOutcomeFor(script, saved);
    const post = executeWithoutSpawning(new Set(), () => executeScriptAgainstState(script, PRE_STATE, " [run H]"));
    assert.equal(post, saved);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getReconstructionCounterSnapshot().sandboxMemoHits, 1);
});

test("test_executeWithoutSpawning_is_off_again_after_a_throw", () => {
    resetSandboxState();
    assert.throws(() => executeWithoutSpawning(new Set(), () => executeScriptAgainstState("pass\n", PRE_STATE)));
    assert.equal(assertSpawnAllowed("pass\n", ""), true);
});

test("test_collectEarlierRuns_records_one_entry_per_miss_and_one_per_failed_memo_hit", () => {
    resetSandboxState();
    storeOutcomeFor("crashed\n", undefined);
    storeOutcomeFor("saved\n", new Map());
    const collected: (Map<string, string> | undefined)[] = [];
    const reports = collectEarlierRuns(new Set(["never\n"]), () => {
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

test("test_collectEarlierRuns_is_off_again_after_a_throw", () => {
    resetSandboxState();
    assert.throws(() => collectEarlierRuns(new Set(), () => {
        throw new Error("boom");
    }), /boom/);
    assert.equal(assertSpawnAllowed("pass\n", ""), true);
});

test("test_executeWithoutSpawning_restores_the_outer_mode_after_a_nested_call", () => {
    resetSandboxState();
    const reports = collectEarlierRuns(new Set(), () => {
        executeWithoutSpawning(new Set(["x\n"]), () => assertSpawnAllowed("x\n", ""));
        assertSpawnAllowed("outer\n", " [outer]");
    });
    assert.deepEqual(reports, [{ script: "outer\n", label: " [outer]", state: WireNeedState.unreplayed }]);
});

test("test_executeSkippingMisses_returns_false_without_throwing_under_throw_mode", () => {
    resetSandboxState();
    const isAllowed = executeWithoutSpawning(new Set(), () => executeSkippingMisses(() => assertSpawnAllowed("skip\n", " [run K]")));
    assert.equal(isAllowed, false);
});

test("test_executeSkippingMisses_adds_no_report_under_collect_mode_and_restores_the_outer_guard", () => {
    resetSandboxState();
    const insideResults: boolean[] = [];
    const reports = collectEarlierRuns(new Set(), () => {
        insideResults.push(executeSkippingMisses(() => assertSpawnAllowed("skip\n", " [run K]")));
        assertSpawnAllowed("outer\n", " [outer]");
    });
    assert.deepEqual(insideResults, [false]);
    assert.deepEqual(reports, [{ script: "outer\n", label: " [outer]", state: WireNeedState.unreplayed }]);
});

test("test_executeSkippingMisses_restores_throw_mode_for_the_outer_guard", () => {
    resetSandboxState();
    assert.throws(
        () => executeWithoutSpawning(new Set(), () => {
            executeSkippingMisses(() => assertSpawnAllowed("skip\n", ""));
            assertSpawnAllowed("outer\n", " [outer]");
        }),
        EarlierRunNotSavedError,
    );
});

test("test_executeSkippingMisses_allows_a_spawn_when_no_guard_is_on", () => {
    resetSandboxState();
    assert.equal(executeSkippingMisses(() => assertSpawnAllowed("free\n", "")), true);
});

test("test_executeSkippingMisses_returns_undefined_for_a_miss_through_the_sandbox_and_spawns_nothing", () => {
    resetSandboxState();
    const script = "print('skipped')\n";
    const post = executeWithoutSpawning(new Set(), () => executeSkippingMisses(() => executeScriptAgainstState(script, PRE_STATE, " [run S]")));
    assert.equal(post, undefined);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey(script, PRE_STATE)), undefined);
});
