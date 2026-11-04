// Order rules: an earlier run with no saved result stops the replay. Tests that spawn use real Docker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import { resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { isImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { EarlierRunNotSavedError } from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import {
    APPEND_Y_SCRIPT,
    APPEND_Z_SCRIPT,
    OPTIONS,
    addFullRead,
    addScriptRun,
    addWrite,
    countSpawns,
    createCraftedProject,
    collectReplay,
    resetRunState,
    writeCraftedSession,
} from "./layer1_run_test_helpers.ts";

function craftTwoRunSession() {
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_B", 8, { code: APPEND_Y_SCRIPT });
    addFullRead(project, "toolu_r", 10, "a.txt", "a\nz\ny\n");
    return { aInput: writeCraftedSession(project, "toolu_A"), bInput: writeCraftedSession(project, "toolu_B") };
}

test("test_executeRunReplay_an_earlier_run_without_a_saved_result_throws_naming_it_and_spawns_nothing", OPTIONS, async () => {
    resetRunState();
    const { bInput } = craftTwoRunSession();
    const gateBefore = isImpureExecutionAllowed();
    await assert.rejects(() => collectReplay(bInput), EarlierRunNotSavedError);
    assert.equal(countSpawns(), 0);
    assert.equal(isImpureExecutionAllowed(), gateBefore);
});

test("test_executeRunReplay_the_later_run_starts_from_the_saved_output_of_the_earlier_run", OPTIONS, async () => {
    resetRunState();
    const { aInput, bInput } = craftTwoRunSession();
    await collectReplay(aInput);
    assert.equal(countSpawns(), 1);
    resetReconstructionCounters();
    const { result } = await collectReplay(bInput);
    assert.equal(countSpawns(), 1);
    assert.equal(result!.outcome, WireRunOutcome.replayed);
    assert.equal(result!.confidence, WireConfidence.verified);
});
