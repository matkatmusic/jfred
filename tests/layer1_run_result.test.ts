import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import {
    OUTPUT_NOT_SAVED_REASON,
    createFailedResult,
    createOriginalFailedResult,
    createReplayedResult,
    createResult,
} from "../src/layer1_run_result.ts";
import { BOX_BLOCKED_REASON_PREFIX } from "../src/layer1_run_skip.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const TOOL_USE_ID = new Uuid("toolu_r");
const RUN: ScriptRun = { code: 'open("a.txt", "w").write("x")\n', timestamp: new Date("2026-07-24T10:00:05Z") };
const MOUNT = new Path("/repo");

test("test_createResult_fills_the_wire_defaults", () => {
    const result = createResult(TOOL_USE_ID, WireRunOutcome.notReplayed, { reason: "why" });
    assert.deepEqual(result, {
        kind: "script-result", toolUseId: "toolu_r", outcome: "not-replayed", reason: "why",
        files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true,
    });
});

test("test_createOriginalFailedResult_sets_the_run_confidence_directly_and_lists_the_named_files", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-result-"));
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    const result = createOriginalFailedResult(TOOL_USE_ID, RUN, new Path(dir));
    assert.equal(result.outcome, WireRunOutcome.originalFailed);
    assert.equal(result.confidence, WireConfidence.originalFailed);
    assert.deepEqual(result.files, [{ path: "a.txt", confidence: WireConfidence.originalFailed }]);
});

test("test_createReplayedResult_takes_the_worst_file_confidence_and_the_saved_output", () => {
    const files = [
        { path: "a.txt", confidence: WireConfidence.verified },
        { path: "b.txt", confidence: WireConfidence.mismatch },
    ];
    const output = { stdout: "out\n", stderr: "err\n", exitCode: 0, timedOut: false };
    const result = createReplayedResult(TOOL_USE_ID, { post: new Map(), output }, files);
    assert.equal(result.outcome, WireRunOutcome.replayed);
    assert.equal(result.confidence, WireConfidence.mismatch);
    assert.equal(result.stdout, "out\n");
    assert.equal(result.stderr, "err\n");
    assert.equal(result.exitCode, 0);
    assert.equal(result.isOutputSaved, true);
});

test("test_createReplayedResult_has_no_confidence_key_for_no_files_and_marks_missing_output", () => {
    const result = createReplayedResult(TOOL_USE_ID, { post: new Map() }, []);
    assert.equal("confidence" in result, false);
    assert.equal(result.isOutputSaved, false);
});

test("test_createFailedResult_reports_a_timeout_a_crash_a_box_block_and_missing_output", () => {
    const failed = (stderr: string, timedOut: boolean, exitCode?: number) =>
        createFailedResult(TOOL_USE_ID, { post: undefined, output: { stdout: "", stderr, timedOut, ...(exitCode === undefined ? {} : { exitCode }) } }, MOUNT);
    assert.equal(failed("", true).timedOut, true);
    assert.match(failed("", true).reason!, /5 seconds/);
    assert.match(failed("ValueError: bad\n", false, 1).reason!, /exit code 1/);
    assert.ok(failed("OSError: Network is unreachable\n", false, 1).reason!.startsWith(BOX_BLOCKED_REASON_PREFIX));
    assert.equal(failed("x", false, 1).outcome, WireRunOutcome.replayFailed);
    assert.equal("confidence" in failed("x", false, 1), false);
    const unsaved = createFailedResult(TOOL_USE_ID, { post: undefined }, MOUNT);
    assert.equal(unsaved.reason, OUTPUT_NOT_SAVED_REASON);
    assert.equal(unsaved.isOutputSaved, false);
});

test("test_createFailedResult_does_not_report_a_box_block_for_a_repo_file_outside_the_cwd", () => {
    // The box mount is the repo root, so a repo file outside the cwd is inside the box.
    const stderr = "FileNotFoundError: [Errno 2] No such file or directory: '/repo/other.py'\n";
    const result = createFailedResult(TOOL_USE_ID, { post: undefined, output: { stdout: "", stderr, timedOut: false, exitCode: 1 } }, MOUNT);
    assert.equal(result.reason!.startsWith(BOX_BLOCKED_REASON_PREFIX), false);
});
