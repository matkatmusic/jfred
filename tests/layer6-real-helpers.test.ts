// Tests for the pure helpers of the Layer 6 real-data check.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import { type WireScriptRunsView } from "../webapp/layer1-wire-script-runs.ts";
import {
    findMissingPhrases, formatOutcomeCounts, isAttempted, isRectLeftOf, isReplayWithoutFile, listCandidateRuns,
    convertStateClassToTerminalClass, parseStreamResult, findReplayedAttemptWithFile, REQUIRED_DIALOG_PHRASES, type ReplayAttempt,
} from "../scripts/visual/layer6-real-helpers.ts";

const buildRun = (toolUseId: string, instant: string, language: string) => ({
    toolUseId, instant, language, executorKind: "python", code: "", sessionId: "s", sessionFile: "f.jsonl", line: 1,
});
const buildResult = (outcome: string, files: number): WireScriptResult => ({
    kind: "script-result", toolUseId: "t", outcome, files: Array(files).fill({ path: "a", confidence: "verified" }),
    stdout: "", stderr: "", timedOut: false, isOutputSaved: true,
} as WireScriptResult);
const buildAttempt = (toolUseId: string, outcome: string, files = 1): ReplayAttempt =>
    ({ toolUseId, outcome, ms: 1, result: buildResult(outcome, files) } as ReplayAttempt);

test("listCandidateRuns keeps python runs once each, in time order", () => {
    const view = { pairs: [
        { path: "a", scriptRuns: [buildRun("late", "2026-01-02T00:00:00Z", "python"), buildRun("sh", "2026-01-01T00:00:00Z", "bash")] },
        { path: "b", scriptRuns: [buildRun("late", "2026-01-02T00:00:00Z", "python"), buildRun("early", "2026-01-01T00:00:00Z", "python3")] },
    ] } as unknown as WireScriptRunsView;
    assert.deepEqual(listCandidateRuns(view).map((run) => run.toolUseId), ["early", "late"]);
});

test("findReplayedAttemptWithFile returns the first replayed attempt that has a file", () => {
    const attempts = [buildAttempt("a", "replay-failed"), buildAttempt("e", "replayed", 0), buildAttempt("b", "replayed"), buildAttempt("c", "replayed")];
    assert.equal(findReplayedAttemptWithFile(attempts)?.toolUseId, "b");
    assert.equal(findReplayedAttemptWithFile([buildAttempt("a", "original-failed")]), undefined);
    assert.equal(findReplayedAttemptWithFile([buildAttempt("e", "replayed", 0)]), undefined);
});

test("isAttempted and formatOutcomeCounts read the attempts", () => {
    const attempts = [buildAttempt("a", "replayed"), buildAttempt("b", "not-replayed")];
    assert.equal(isAttempted(attempts, "a"), true);
    assert.equal(isAttempted(attempts, "z"), false);
    assert.equal(formatOutcomeCounts(attempts), "replayed=1, original-failed=0, replay-failed=0, not-replayed=1");
});

test("isReplayWithoutFile is true only for a replayed run with no files", () => {
    assert.equal(isReplayWithoutFile(buildResult("replayed", 0)), true);
    assert.equal(isReplayWithoutFile(buildResult("replayed", 2)), false);
    assert.equal(isReplayWithoutFile(buildResult("replay-failed", 0)), false);
});

test("parseStreamResult returns the result line and throws on an error line or no result", () => {
    const resultLine = JSON.stringify(buildResult("replayed", 1));
    const outputLine = JSON.stringify({ kind: "script-output", stream: "stdout", text: "x" });
    assert.equal(parseStreamResult(`${outputLine}\n${resultLine}\n`).outcome, "replayed");
    assert.throws(() => parseStreamResult(`${JSON.stringify({ kind: "error", label: "earlier run not saved" })}\n`), /earlier run not saved/);
    assert.throws(() => parseStreamResult(`${outputLine}\n`), /no result line/);
});

test("convertStateClassToTerminalClass maps the run-state class", () => {
    assert.equal(convertStateClassToTerminalClass("node n-script run-state-verified"), "term-verified");
    assert.equal(convertStateClassToTerminalClass("node n-script run-state-original-failed"), "term-original-failed");
    assert.equal(convertStateClassToTerminalClass("node n-script"), undefined);
});

test("isRectLeftOf and findMissingPhrases", () => {
    assert.equal(isRectLeftOf(100, 100), true);
    assert.equal(isRectLeftOf(101, 100), false);
    assert.deepEqual(findMissingPhrases("copied files only, no network", REQUIRED_DIALOG_PHRASES), ["Docker container", "Docker must be on"]);
});
