// No Docker: a guarded build never spawns, so a memo miss throws or is reported.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRunStartFiles, loadReplayRun } from "../src/layer1_run_start_files.ts";
import { isImpureExecutionAllowed, setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { getReconstructionCounterSnapshot, resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { computeSandboxInputKey } from "../src/reconstruction_script_sandbox.ts";
import { setSandboxMemoPersistence, storeSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";
import { EarlierRunNotSavedError, assertSpawnAllowed, collectEarlierRuns, executeWithoutSpawning } from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import {
    APPEND_Y_SCRIPT,
    APPEND_Z_SCRIPT,
    addScriptRun,
    addWrite,
    createCraftedProject,
    writeCraftedSession,
} from "./layer1_run_test_helpers.ts";

function resetRunState(): void {
    setSandboxMemoPersistence(undefined);
    resetReconstructionCounters();
}

// Write a.txt, then run A (appends z), then run B (appends y).
function craftTwoRunSession() {
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_B", 8, { code: APPEND_Y_SCRIPT });
    return { project, input: writeCraftedSession(project, "toolu_B") };
}

test("test_loadReplayRun_finds_the_run_by_tool_use_id", () => {
    const { input } = craftTwoRunSession();
    assert.equal(loadReplayRun(input).run.code, APPEND_Y_SCRIPT);
});

test("test_loadReplayRun_throws_for_an_unknown_id", () => {
    const { input } = craftTwoRunSession();
    assert.throws(() => loadReplayRun({ ...input, toolUseId: new Uuid("toolu_missing") }), /no script run/);
});

test("test_computeRunStartFiles_throws_EarlierRunNotSavedError_when_the_earlier_run_has_no_saved_result", () => {
    resetRunState();
    const { input } = craftTwoRunSession();
    assert.throws(() => computeRunStartFiles(loadReplayRun(input), undefined, executeWithoutSpawning), EarlierRunNotSavedError);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
});

test("test_computeRunStartFiles_reads_the_saved_output_of_the_earlier_run", () => {
    resetRunState();
    const { input } = craftTwoRunSession();
    const earlierPre = new Map([["a.txt", "a\n"]]);
    storeSandboxOutcome(computeSandboxInputKey(APPEND_Z_SCRIPT, earlierPre, new Path(input.dir.toString())), new Map([["a.txt", "a\nz\n"]]));
    const startFiles = computeRunStartFiles(loadReplayRun(input), undefined, executeWithoutSpawning);
    assert.equal(startFiles.pre.get("a.txt"), "a\nz\n");
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
});

test("test_computeRunStartFiles_collect_mode_lists_the_earlier_run_and_spawns_nothing", () => {
    resetRunState();
    const { input } = craftTwoRunSession();
    const startFiles = computeRunStartFiles(loadReplayRun(input), undefined, collectEarlierRuns);
    assert.equal(startFiles.lineageResult.length, 1);
    assert.equal(startFiles.lineageResult[0]!.script, APPEND_Z_SCRIPT);
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
});

test("test_computeRunStartFiles_does_not_throw_or_spawn_for_an_errored_or_javascript_earlier_run", () => {
    resetRunState();
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_E", 4, { code: APPEND_Z_SCRIPT }, { isErrored: true });
    addScriptRun(project, "toolu_J", 5, { code: 'require("fs").writeFileSync("a.txt", "js")\n', language: "javascript" });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    const input = writeCraftedSession(project, "toolu_T");
    const startFiles = computeRunStartFiles(loadReplayRun(input), undefined, executeWithoutSpawning);
    assert.equal(startFiles.pre.get("a.txt"), "a\n");
    assert.equal(getReconstructionCounterSnapshot().sandboxSpawns, 0);
});

test("test_computeRunStartFiles_restores_the_gate_after_a_return_and_after_a_throw", () => {
    resetRunState();
    const { input } = craftTwoRunSession();
    setImpureExecutionAllowed(false);
    try {
        assert.throws(() => computeRunStartFiles(loadReplayRun(input), undefined, executeWithoutSpawning));
        assert.equal(isImpureExecutionAllowed(), false);
        computeRunStartFiles(loadReplayRun(input), undefined, collectEarlierRuns);
        assert.equal(isImpureExecutionAllowed(), false);
    }
    finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_computeRunStartFiles_leaves_spawning_allowed_again_after_a_throw", () => {
    resetRunState();
    const { input } = craftTwoRunSession();
    assert.throws(() => computeRunStartFiles(loadReplayRun(input), undefined, executeWithoutSpawning), EarlierRunNotSavedError);
    assert.equal(assertSpawnAllowed("print(1)\n", ""), true);
});
