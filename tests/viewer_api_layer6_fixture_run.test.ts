// Task 358 part F: tests for the fixture run route.

import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { EarlierRunNotSavedError } from "../src/reconstruction_script_sandbox_spawn_guard.ts";
import { FIXTURE_RUN_ID } from "../src/viewer_api_layer6_fixture_blocked_runs.ts";
import { findCannedFixtureRun } from "../src/viewer_api_layer6_fixture_data.ts";
import { savedFixtureRuns } from "../src/viewer_api_layer6_fixture_needs.ts";
import { sendFixtureRun } from "../src/viewer_api_layer6_fixture_run.ts";

type Line = Record<string, unknown>;

function buildFakeResponse(onWrite: (emitter: EventEmitter) => void = () => undefined): { response: ServerResponse; lines: Line[]; state: { isEnded: boolean } } {
    const lines: Line[] = [];
    const state = { isEnded: false };
    const emitter = new EventEmitter();
    const response = Object.assign(emitter, {
        writeHead: () => undefined,
        write: (text: string) => {
            lines.push(JSON.parse(text) as Line);
            onWrite(emitter);
            return true;
        },
        end: () => {
            state.isEnded = true;
        },
    });
    return { response: response as unknown as ServerResponse, lines, state };
}

async function streamRun(toolUseId: string, allowScripts = true): Promise<{ lines: Line[]; state: { isEnded: boolean } }> {
    const fake = buildFakeResponse();
    await sendFixtureRun({ sessionFile: "fixture.jsonl", toolUseId, allowScripts }, fake.response);
    return { lines: fake.lines, state: fake.state };
}

test("without allowScripts the run route answers consent-required and nothing else", async () => {
    savedFixtureRuns.clear();
    const { lines, state } = await streamRun(FIXTURE_RUN_ID.pre, false);
    assert.deepEqual(lines, [{ kind: "consent-required" }]);
    assert.equal(state.isEnded, true);
    assert.equal(savedFixtureRuns.size, 0);
});

const OUTCOME_CASES = [
    { id: FIXTURE_RUN_ID.pre, outcome: "replayed", confidence: "verified", outputLines: 3 },
    { id: FIXTURE_RUN_ID.replayMismatch, outcome: "replayed", confidence: "mismatch", outputLines: 2 },
    { id: FIXTURE_RUN_ID.skipAfter, outcome: "replayed", confidence: "injected-unverified", outputLines: 1 },
    { id: FIXTURE_RUN_ID.skipFailed, outcome: "original-failed", confidence: "original-failed", outputLines: 0 },
    { id: FIXTURE_RUN_ID.crashBlocker, outcome: "replay-failed", confidence: undefined, outputLines: 2 },
    { id: FIXTURE_RUN_ID.replayNotReplayed, outcome: "not-replayed", confidence: undefined, outputLines: 0 },
];

for (const outcomeCase of OUTCOME_CASES) {
    test(`the run route answers ${outcomeCase.outcome} for ${outcomeCase.id}`, async () => {
        savedFixtureRuns.clear();
        const { lines, state } = await streamRun(outcomeCase.id);
        const result = lines.at(-1)!;
        assert.equal(result["kind"], "script-result");
        assert.equal(result["toolUseId"], outcomeCase.id);
        assert.equal(result["outcome"], outcomeCase.outcome);
        assert.equal(result["confidence"], outcomeCase.confidence);
        assert.equal(lines.length - 1, outcomeCase.outputLines);
        assert.ok(lines.slice(0, -1).every((line) => line["kind"] === "script-output"));
        assert.equal(state.isEnded, true);
    });
}

test("a result with a confidence lists that confidence for each file the run changed", async () => {
    const { lines } = await streamRun(FIXTURE_RUN_ID.pre);
    assert.deepEqual(lines.at(-1)!["files"], [{ path: "README.md", confidence: "verified" }]);
});

test("the pre run streams three stdout lines and joins them into the result", async () => {
    const { lines } = await streamRun(FIXTURE_RUN_ID.pre);
    assert.deepEqual(lines.slice(0, 3).map((line) => line["text"]), ["reading README.md\n", "writing README.md\n", "done\n"]);
    assert.equal(lines.at(-1)!["stdout"], "reading README.md\nwriting README.md\ndone");
});

test("the slow run is canned as six lines, 150 ms apart", () => {
    const canned = findCannedFixtureRun(FIXTURE_RUN_ID.slow);
    assert.equal(canned.lines.length, 6);
    assert.equal(canned.lineDelayMs, 150);
});

test("the slow run ends early when the response closes and is not saved", async () => {
    savedFixtureRuns.clear();
    const fake = buildFakeResponse((emitter) => emitter.emit("close"));
    await sendFixtureRun({ sessionFile: "fixture.jsonl", toolUseId: FIXTURE_RUN_ID.slow, allowScripts: true }, fake.response);
    assert.equal(fake.lines.length, 1);
    assert.equal(fake.state.isEnded, false);
    assert.equal(savedFixtureRuns.has(FIXTURE_RUN_ID.slow), false);
});

test("a result that is verified, mismatch, injected-unverified or replay-failed is saved", async () => {
    savedFixtureRuns.clear();
    const savedIds = [FIXTURE_RUN_ID.pre, FIXTURE_RUN_ID.replayMismatch, FIXTURE_RUN_ID.skipAfter, FIXTURE_RUN_ID.crashBlocker];
    for (const id of savedIds) {
        await streamRun(id);
    }
    assert.deepEqual([...savedFixtureRuns], savedIds);
});

test("a result that is original-failed or not-replayed is not saved", async () => {
    savedFixtureRuns.clear();
    await streamRun(FIXTURE_RUN_ID.skipFailed);
    await streamRun(FIXTURE_RUN_ID.replayNotReplayed);
    assert.equal(savedFixtureRuns.size, 0);
});

test("the blocked run answers the earlier-run error line while its blocker is not saved", async () => {
    savedFixtureRuns.clear();
    const { lines, state } = await streamRun(FIXTURE_RUN_ID.blocked);
    assert.deepEqual(lines, [{ kind: "error", label: new EarlierRunNotSavedError("").message }]);
    assert.equal(state.isEnded, true);
});

test("the blocked run answers its result once the blocker result was answered", async () => {
    savedFixtureRuns.clear();
    await streamRun(FIXTURE_RUN_ID.blocker);
    const { lines } = await streamRun(FIXTURE_RUN_ID.blocked);
    assert.equal(lines.at(-1)!["outcome"], "replayed");
    assert.equal(lines.at(-1)!["confidence"], "verified");
});

test("the crash-blocked run keeps answering the error line after its blocker crashed", async () => {
    savedFixtureRuns.clear();
    await streamRun(FIXTURE_RUN_ID.crashBlocker);
    const { lines } = await streamRun(FIXTURE_RUN_ID.crashBlocked);
    assert.deepEqual(lines, [{ kind: "error", label: new EarlierRunNotSavedError("").message }]);
});
