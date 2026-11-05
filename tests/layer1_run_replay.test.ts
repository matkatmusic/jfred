// Tests that spawn use real Docker. They start only after the proof gate (part DK) is green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import { executeRunReplay } from "../src/layer1_run_replay.ts";
import { resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { getMemoizedSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import {
    APPEND_Z_SCRIPT, OPTIONS, addFullRead, addScriptRun, addWrite, computeBoxedRunKey, countSpawns, createCraftedGitRepo, createCraftedSession,
    createCraftedProject, collectReplay, resetRunState, writeCraftedSession, writeProjectFile,
} from "./layer1_run_test_helpers.ts";

const HELLO_SCRIPT = `print("hello")\n${APPEND_Z_SCRIPT}`;

test("test_executeRunReplay_original_failed_does_not_spawn", OPTIONS, async () => {
    resetRunState();
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_T", 5, { code: APPEND_Z_SCRIPT }, { isErrored: true });
    writeProjectFile(project, "a.txt", "a\n");
    const { result } = await collectReplay(writeCraftedSession(project, "toolu_T"));
    assert.equal(result!.outcome, WireRunOutcome.originalFailed);
    assert.equal(result!.confidence, WireConfidence.originalFailed);
    assert.deepEqual(result!.files, [{ path: "a.txt", confidence: WireConfidence.originalFailed }]);
    assert.equal(countSpawns(), 0);
});

test("test_executeRunReplay_does_not_replay_a_bash_a_javascript_or_a_read_only_run", OPTIONS, async () => {
    resetRunState();
    const project = createCraftedProject();
    addScriptRun(project, "toolu_B", 2, { command: "echo hi > a.txt" }, { toolName: ToolName.Bash });
    addScriptRun(project, "toolu_J", 3, { code: 'require("fs")\n', language: "javascript" });
    addScriptRun(project, "toolu_R", 4, { code: 'print(open("a.txt").read())\n' });
    const expected: [string, RegExp][] = [["toolu_B", /Bash/], ["toolu_J", /javascript/], ["toolu_R", /only reads/]];
    for (const [toolUseId, reason] of expected) {
        const { result } = await collectReplay(writeCraftedSession(project, toolUseId));
        assert.equal(result!.outcome, WireRunOutcome.notReplayed);
        assert.match(result!.reason!, reason);
    }
    assert.equal(countSpawns(), 0);
});

test("test_executeRunReplay_with_no_start_files_is_not_replayed", OPTIONS, async () => {
    resetRunState();
    const project = createCraftedProject();
    addScriptRun(project, "toolu_T", 5, { code: 'open("out.txt", "w").write("x")\n' });
    const { result } = await collectReplay(writeCraftedSession(project, "toolu_T"));
    assert.equal(result!.outcome, WireRunOutcome.notReplayed);
    assert.equal(result!.reason, "no known start files");
    assert.equal(countSpawns(), 0);
});

test("test_executeRunReplay_with_no_start_files_but_a_commit_before_the_run_is_replayed", OPTIONS, async () => {
    // Scenario: no start files, but the repo has a commit before the run, so the box has a project.
    resetRunState();
    const project = createCraftedProject();
    addScriptRun(project, "toolu_T", 5, { code: 'open("out.txt", "w").write("x")\n' });
    const input = { ...writeCraftedSession(project, "toolu_T"), repoPath: createCraftedGitRepo() };
    const { result } = await collectReplay(input);
    assert.notEqual(result!.outcome, WireRunOutcome.notReplayed);
    assert.equal(countSpawns(), 1);
});

test("test_executeRunReplay_is_verified_when_the_beacon_equals_and_reports_progress_and_output", OPTIONS, async () => {
    resetRunState();
    const { input } = createCraftedSession(HELLO_SCRIPT, (project) => addFullRead(project, "toolu_r", 10, "a.txt", "a\nz\n"));
    const { result, progress, outputs } = await collectReplay(input);
    assert.equal(result!.outcome, WireRunOutcome.replayed);
    assert.equal(result!.confidence, WireConfidence.verified);
    assert.deepEqual(result!.files, [{ path: "a.txt", confidence: WireConfidence.verified }]);
    assert.equal(result!.stdout, "hello\n");
    assert.equal(outputs.join(""), "hello\n");
    assert.deepEqual(progress.map((event) => event.current), [1, 2, 3, 4, 5]);
    assert.ok(progress.every((event) => event.total === 5));
    assert.equal(countSpawns(), 1);
});

test("test_executeRunReplay_is_mismatch_when_the_beacon_differs", OPTIONS, async () => {
    resetRunState();
    const { input } = createCraftedSession(APPEND_Z_SCRIPT, (project) => addFullRead(project, "toolu_r", 10, "a.txt", "a\nQ\n"));
    const { result } = await collectReplay(input);
    assert.equal(result!.confidence, WireConfidence.mismatch);
});

test("test_executeRunReplay_without_a_beacon_follows_the_working_tree", OPTIONS, async () => {
    resetRunState();
    const matching = createCraftedSession(APPEND_Z_SCRIPT);
    writeProjectFile(matching.project, "a.txt", "a\nz\n");
    assert.equal((await collectReplay(matching.input)).result!.confidence, WireConfidence.verified);
    resetRunState();
    const different = createCraftedSession(APPEND_Z_SCRIPT);
    writeProjectFile(different.project, "a.txt", "different\n");
    assert.equal((await collectReplay(different.input)).result!.confidence, WireConfidence.injectedUnverified);
});

test("test_executeRunReplay_a_change_between_the_run_and_the_beacon_is_injected_unverified", OPTIONS, async () => {
    resetRunState();
    const { input } = createCraftedSession(APPEND_Z_SCRIPT, (project) => {
        addWrite(project, "toolu_w2", 7, "a.txt", "other\n");
        addFullRead(project, "toolu_r", 10, "a.txt", "other\n");
    });
    const { result } = await collectReplay(input);
    assert.equal(result!.confidence, WireConfidence.injectedUnverified);
});

test("test_executeRunReplay_a_memo_hit_does_not_spawn_and_returns_the_saved_output", OPTIONS, async () => {
    resetRunState();
    const { input } = createCraftedSession(HELLO_SCRIPT);
    await collectReplay(input);
    resetReconstructionCounters();
    const { result } = await collectReplay(input);
    assert.equal(result!.stdout, "hello\n");
    assert.equal(result!.isOutputSaved, true);
    assert.equal(countSpawns(), 0);
});

test("test_executeRunReplay_a_crash_is_replay_failed_and_saved_so_it_is_not_run_again", OPTIONS, async () => {
    resetRunState();
    const { input } = createCraftedSession(`import sys\n${APPEND_Z_SCRIPT}sys.exit(3)\n`);
    const first = await collectReplay(input);
    assert.equal(first.result!.outcome, WireRunOutcome.replayFailed);
    assert.match(first.result!.reason!, /exit code 3/);
    assert.equal(first.result!.exitCode, 3);
    assert.equal("confidence" in first.result!, false);
    resetReconstructionCounters();
    assert.equal((await collectReplay(input)).result!.outcome, WireRunOutcome.replayFailed);
    assert.equal(countSpawns(), 0);
});

test("test_executeRunReplay_a_cancel_returns_undefined_and_saves_nothing", OPTIONS, async () => {
    resetRunState();
    const code = `print("ready", flush=True)\nimport time\ntime.sleep(30)\n${APPEND_Z_SCRIPT}`;
    const { input } = createCraftedSession(code);
    const controller = new AbortController();
    const outputs: string[] = [];
    const abortOnReady = (_stream: string, text: string) => {
        outputs.push(text);
        controller.abort();
    };
    const result = await executeRunReplay(input, () => {}, abortOnReady, controller.signal);
    assert.equal(result, undefined);
    assert.equal(outputs.join(""), "ready\n");
    const pre = new Map([["a.txt", "a\n"]]);
    assert.equal(getMemoizedSandboxOutcome(computeBoxedRunKey(input, "toolu_T", pre)), undefined);
});

test("test_executeRunReplay_throws_for_an_unknown_tool_use_id", OPTIONS, async () => {
    resetRunState();
    const { input } = createCraftedSession(APPEND_Z_SCRIPT);
    await assert.rejects(() => collectReplay({ ...input, toolUseId: new Uuid("toolu_missing") }), /no script run/);
});
