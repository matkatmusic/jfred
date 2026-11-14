// GET /api/layer1-session-dot-instants over a real HTTP server: one project log, one dot.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { createFixtureDiskFolder, launchFixtureViewer } from "./layer1-view-test-helpers.ts";
import { SESSION_A, buildPromptRecord } from "./multi-source-test-helpers.ts";
import { writeSessionTranscript } from "./layer1-snapshot-wire-test-helpers.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { encodeProjectFolderName } from "../src/reconstruction_repo_discovery.ts";
import type { WireSessionDotInstants } from "../webapp/layer1-components/session-column/layer1-wire-session-instants.ts";

// 24000 to 24499: no other server test uses this block.
const SCRATCH_PORT = 24000 + (process.pid % 500);

const DOT_INSTANT = "2026-07-24T10:00:00.000Z";

const diskDir = createFixtureDiskFolder();
const logTreeRoot = createTempDir();
let child: ChildProcess | undefined = undefined;

before(async () => {
    writeSessionTranscript(logTreeRoot, SESSION_A, [buildPromptRecord("prompt-one", null, DOT_INSTANT, diskDir)], encodeProjectFolderName(diskDir));
    child = await launchFixtureViewer(diskDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

test("test_the_server_answers_the_dot_instants_route_over_http", async () => {
    // Scenario: a running viewer server answers GET /api/layer1-session-dot-instants for a project log.
    // Steps:
    // a project log holds one user record at 10:00 (written in before).
    // ask the route with the log folder as the jsonl param (no from/to: the whole index).
    const query = new URLSearchParams({ dir: diskDir });
    query.append("jsonl", logTreeRoot);
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/layer1-session-dot-instants?${query.toString()}`);
    // the route exists and answers 200 (404 before the route is registered).
    assert.equal(response.status, 200);
    // the body holds exactly one session entry for the session of that record.
    const body = await response.json() as WireSessionDotInstants;
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0]!.sessionId, SESSION_A);
    // the entry holds one delta: the absolute epoch ms of the 10:00 record.
    assert.deepEqual(body.sessions[0]!.deltasMs, [Date.parse(DOT_INSTANT)]);
});

test("test_the_dot_instants_route_without_jsonl_answers_an_error", async () => {
    // Scenario: the route refuses a request that names no log folder.
    // Steps:
    // ask the route with only the dir param.
    const query = new URLSearchParams({ dir: diskDir });
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/layer1-session-dot-instants?${query.toString()}`);
    // the server turns the thrown "missing query param: jsonl" into 400 (an unregistered route would give 404).
    assert.equal(response.status, 400);
    const message = await response.text();
    assert.match(message, /missing query param: jsonl/);
});
