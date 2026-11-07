// Part NS: computeRunNeeds lists earlier runs with no saved result; it never spawns and never stores. No Docker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireNeedState } from "../webapp/layer1-wire-script-results.ts";
import { computeRunNeeds } from "../src/layer1_run_needs.ts";
import { isImpureExecutionAllowed, setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import type { RunInput } from "../src/layer1_run_start_files.ts";
import { getMemoizedSandboxOutcome, storeSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";
import { Uuid } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import {
    APPEND_Y_SCRIPT,
    APPEND_Z_SCRIPT,
    addScriptRun,
    addWrite,
    computeBoxedRunKey,
    countSpawns,
    createCraftedGitRepo,
    createCraftedProject,
    resetRunState,
    writeCraftedSession,
} from "./layer1_run_test_helpers.ts";

const APPEND_X_SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "x\\n")\n';
const WRITE_B_SCRIPT = 'open("b.txt", "w").write("b\\n")\n';
const WRITE_NEW_FILE_SCRIPT = 'open("zzz.txt", "w").write("q")\n';

// Write a.txt (s1), run A (s5, appends z), run T (s8, appends y).
function craftOneEarlierRun() {
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    return { project, input: writeCraftedSession(project, "toolu_T") };
}

function storeEarlierRunOutcome(input: RunInput, post: Map<string, string> | undefined): void {
    const key = computeBoxedRunKey(input, "toolu_A", new Map([["a.txt", "a\n"]]));
    storeSandboxOutcome(key, post);
}

test("test_computeRunNeeds_lists_the_earlier_run_that_has_no_saved_result", () => {
    resetRunState();
    const { input } = craftOneEarlierRun();
    const needs = computeRunNeeds(input);
    assert.equal(needs.length, 1);
    assert.equal(needs[0]!.toolUseId, "toolu_A");
    assert.equal(needs[0]!.state, WireNeedState.unreplayed);
    assert.equal(needs[0]!.sessionFile, input.sessionFile.toString());
    assert.equal(needs[0]!.instant, "2026-07-24T10:00:05.000Z");
    assert.equal(typeof needs[0]!.line, "number");
});

test("test_computeRunNeeds_is_empty_once_the_earlier_run_outcome_is_saved", () => {
    resetRunState();
    const { input } = craftOneEarlierRun();
    storeEarlierRunOutcome(input, new Map([["a.txt", "a\nz\n"]]));
    assert.deepEqual(computeRunNeeds(input), []);
});

test("test_computeRunNeeds_in_a_git_repo_is_empty_once_the_result_is_saved_under_the_live_run_key", () => {
    resetRunState();
    const { input: noGitInput } = craftOneEarlierRun();
    const input = { ...noGitInput, repoPath: createCraftedGitRepo() };
    storeEarlierRunOutcome(input, new Map([["a.txt", "a\nz\n"]]));
    assert.deepEqual(computeRunNeeds(input), []);
});

test("test_computeRunNeeds_marks_a_saved_run_without_result_files_as_replay_failed", () => {
    resetRunState();
    const { input } = craftOneEarlierRun();
    storeEarlierRunOutcome(input, undefined);
    const needs = computeRunNeeds(input);
    assert.equal(needs.length, 1);
    assert.equal(needs[0]!.toolUseId, "toolu_A");
    assert.equal(needs[0]!.state, WireNeedState.replayFailed);
});

test("test_computeRunNeeds_still_lists_an_earlier_run_that_changes_another_file", () => {
    resetRunState();
    const project = createCraftedProject();
    addWrite(project, "toolu_w1", 1, "a.txt", "a\n");
    addWrite(project, "toolu_w2", 2, "b.txt", "b\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: WRITE_B_SCRIPT });
    const needs = computeRunNeeds(writeCraftedSession(project, "toolu_T"));
    assert.deepEqual(needs.map((need) => need.toolUseId), ["toolu_A"]);
});

test("test_computeRunNeeds_does_not_list_errored_javascript_bash_or_no_start_file_runs", () => {
    resetRunState();
    const project = createCraftedProject();
    addScriptRun(project, "toolu_N", 0, { code: WRITE_NEW_FILE_SCRIPT });
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_E", 4, { code: APPEND_Z_SCRIPT }, { isErrored: true });
    addScriptRun(project, "toolu_J", 5, { code: 'require("fs").writeFileSync("a.txt", "js")\n', language: "javascript" });
    addScriptRun(project, "toolu_B", 6, { command: "echo hi" }, { toolName: ToolName.Bash });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    assert.deepEqual(computeRunNeeds(writeCraftedSession(project, "toolu_T")), []);
    assert.equal(countSpawns(), 0);
});

test("test_computeRunNeeds_is_empty_when_the_target_run_itself_failed_originally", () => {
    resetRunState();
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT }, { isErrored: true });
    assert.deepEqual(computeRunNeeds(writeCraftedSession(project, "toolu_T")), []);
});

test("test_computeRunNeeds_sorts_two_missing_earlier_runs_by_instant", () => {
    resetRunState();
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_A2", 6, { code: APPEND_X_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    const needs = computeRunNeeds(writeCraftedSession(project, "toolu_T"));
    assert.deepEqual(needs.map((need) => need.toolUseId), ["toolu_A", "toolu_A2"]);
});

test("test_computeRunNeeds_spawns_nothing_stores_nothing_and_keeps_the_gate", () => {
    resetRunState();
    const { input } = craftOneEarlierRun();
    const earlierKey = computeBoxedRunKey(input, "toolu_A", new Map([["a.txt", "a\n"]]));
    setImpureExecutionAllowed(false);
    try {
        computeRunNeeds(input);
        assert.equal(isImpureExecutionAllowed(), false);
        assert.throws(() => computeRunNeeds({ ...input, toolUseId: new Uuid("toolu_missing") }), /no script run/);
        assert.equal(isImpureExecutionAllowed(), false);
    }
    finally {
        setImpureExecutionAllowed(true);
    }
    assert.equal(countSpawns(), 0);
    assert.equal(getMemoizedSandboxOutcome(earlierKey), undefined);
});

test("test_computeRunNeeds_is_empty_when_backup_folder_lost", () => {
    // Scenario: the session records a backup file, but its file-history/<sessionId> folder is gone.
    resetRunState();
    const project = createCraftedProject();
    const backupTime = "2026-07-24T10:00:01.000Z";
    // a snapshot record names backup abc@v1 for a.txt; the crafted tree has no folder for the session.
    project.records.push({ type: "file-history-snapshot", messageId: "m1", isSnapshotUpdate: false, snapshot: {
        messageId: "m1", timestamp: backupTime,
        trackedFileBackups: { "a.txt": { backupFileName: "abc@v1", version: 1, backupTime } },
    } });
    addWrite(project, "toolu_w", 2, "a.txt", "a\n");
    addScriptRun(project, "toolu_A", 5, { code: APPEND_Z_SCRIPT });
    addScriptRun(project, "toolu_T", 8, { code: APPEND_Y_SCRIPT });
    // the earlier run A would be listed as a need, but a lost-folder run lists nothing.
    assert.deepEqual(computeRunNeeds(writeCraftedSession(project, "toolu_T")), []);
    assert.equal(countSpawns(), 0);
});
