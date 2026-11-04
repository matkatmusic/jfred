// Task 358 part F: tests for the fixture needs route and clear route.

import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_RUN_ID } from "../src/viewer_api_layer6_fixture_blocked_runs.ts";
import { FIXTURE_RUN_BLOCKERS } from "../src/viewer_api_layer6_fixture_data.ts";
import {
    listFixtureNeeds,
    receiveFixtureScriptNeeds,
    savedFixtureRuns,
    sendFixtureClearResults,
} from "../src/viewer_api_layer6_fixture_needs.ts";
import { sendFixtureRun } from "../src/viewer_api_layer6_fixture_run.ts";

function buildJsonResponse(): { response: ServerResponse; body: () => unknown } {
    let text = "";
    const response = {
        writeHead: () => undefined,
        write: (chunk: string) => {
            text += chunk;
        },
        end: (chunk?: string) => {
            text += chunk ?? "";
        },
        on: () => undefined,
    } as unknown as ServerResponse;
    return { response, body: () => JSON.parse(text) as unknown };
}

async function answerRun(toolUseId: string): Promise<void> {
    await sendFixtureRun({ sessionFile: "fixture.jsonl", toolUseId, allowScripts: true }, buildJsonResponse().response);
}

test("the needs of the blocked run list the blocker as unreplayed", () => {
    savedFixtureRuns.clear();
    assert.deepEqual(listFixtureNeeds(FIXTURE_RUN_ID.blocked), [{
        toolUseId: FIXTURE_RUN_ID.blocker,
        sessionFile: "/fixture/demo/projects/bulk-1.jsonl",
        line: 101,
        instant: "2026-06-11T13:30:00.000Z",
        state: "unreplayed",
    }]);
});

test("the needs of the blocked run are empty once the blocker result was answered", async () => {
    savedFixtureRuns.clear();
    await answerRun(FIXTURE_RUN_ID.blocker);
    assert.deepEqual(listFixtureNeeds(FIXTURE_RUN_ID.blocked), []);
});

test("a crash blocker stays listed as replay-failed after its result was answered", async () => {
    savedFixtureRuns.clear();
    await answerRun(FIXTURE_RUN_ID.crashBlocker);
    const needs = listFixtureNeeds(FIXTURE_RUN_ID.crashBlocked);
    assert.deepEqual(needs.map((need) => [need.toolUseId, need.state]), [[FIXTURE_RUN_ID.crashBlocker, "replay-failed"]]);
});

test("a run with no canned blocker has no needs", () => {
    savedFixtureRuns.clear();
    assert.deepEqual(listFixtureNeeds(FIXTURE_RUN_ID.pre), []);
});

test("the bash run and the original-failed run are never in any needs list", () => {
    const listedIds = Object.values(FIXTURE_RUN_BLOCKERS).flat();
    assert.ok(!listedIds.includes(FIXTURE_RUN_ID.skipBash));
    assert.ok(!listedIds.includes(FIXTURE_RUN_ID.skipFailed));
});

test("the needs route reads the tool use id from the body and answers the reply", () => {
    savedFixtureRuns.clear();
    const request = new EventEmitter() as unknown as IncomingMessage;
    const { response, body } = buildJsonResponse();
    receiveFixtureScriptNeeds(request, response);
    request.emit("data", Buffer.from(JSON.stringify({ sessionFile: "fixture.jsonl", toolUseId: FIXTURE_RUN_ID.blocked })));
    request.emit("end");
    const reply = body() as { toolUseId: string; needs: { toolUseId: string }[] };
    assert.equal(reply.toolUseId, FIXTURE_RUN_ID.blocked);
    assert.deepEqual(reply.needs.map((need) => need.toolUseId), [FIXTURE_RUN_ID.blocker]);
});

test("the clear route empties the saved set and answers cleared", async () => {
    await answerRun(FIXTURE_RUN_ID.pre);
    assert.ok(savedFixtureRuns.size > 0);
    const { response, body } = buildJsonResponse();
    sendFixtureClearResults(response);
    assert.equal(savedFixtureRuns.size, 0);
    assert.deepEqual(body(), { cleared: true });
    assert.equal(listFixtureNeeds(FIXTURE_RUN_ID.blocked).length, 1);
});
