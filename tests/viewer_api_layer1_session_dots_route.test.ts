// GET /api/layer1-session-dots over a real HTTP server: one project log, one dot in the asked range.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { createFixtureDiskFolder, launchFixtureViewer } from "./layer1-view-test-helpers.ts";
import { SESSION_A, buildPromptRecord } from "./multi-source-test-helpers.ts";
import { writeSessionTranscript } from "./layer1-snapshot-wire-test-helpers.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { encodeProjectFolderName } from "../src/reconstruction_repo_discovery.ts";
import type { WireSessionDots } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import { EARLIEST_INSTANT, LATEST_INSTANT } from "../webapp/layer1-components/session-column/layer1-session-dots-viewport.ts";

// 17400 to 22900 are taken by other server tests: parallel files must never collide.
const SCRATCH_PORT = 23400 + (process.pid % 500);

const DOT_INSTANT = "2026-07-24T10:00:00.000Z";
const RANGE_START = "2026-07-24T09:00:00.000Z";
const RANGE_END = "2026-07-24T11:00:00.000Z";

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

test("test_the_server_answers_the_session_dots_route_over_http", async () => {
    // Scenario: a running viewer server answers GET /api/layer1-session-dots for a project log.
    // Steps:
    // a project log holds one user record at 10:00 (written in before).
    // ask the route for the range 09:00..11:00 with the log folder as the jsonl param.
    const query = new URLSearchParams({ dir: diskDir, from: RANGE_START, to: RANGE_END });
    query.append("jsonl", logTreeRoot);
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/layer1-session-dots?${query.toString()}`);
    // the route exists and answers 200 (404 before the route is registered).
    assert.equal(response.status, 200);
    // the body holds exactly one annotation: the 10:00 record.
    const body = await response.json() as WireSessionDots;
    assert.equal(body.annotations.length, 1);
    assert.equal(body.annotations[0]!.instant, DOT_INSTANT);
});

test("test_the_route_accepts_the_widest_range_and_returns_every_dot", async () => {
    // Scenario: the route answers the widest possible ask (earliest to latest instant) with every dot.
    // Steps:
    // the same project log holds one user record at 10:00 (written in before).
    // ask the route from EARLIEST_INSTANT to LATEST_INSTANT with the log folder as the jsonl param.
    const query = new URLSearchParams({ dir: diskDir, from: EARLIEST_INSTANT, to: LATEST_INSTANT });
    query.append("jsonl", logTreeRoot);
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/layer1-session-dots?${query.toString()}`);
    // the route accepts the edge instants and answers 200.
    assert.equal(response.status, 200);
    // the body holds the one dot.
    const body = await response.json() as WireSessionDots;
    assert.equal(body.annotations.length, 1);
});
