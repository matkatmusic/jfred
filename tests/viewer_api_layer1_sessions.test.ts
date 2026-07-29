// GET /api/layer1-sessions and GET /api/scan-source (tasks 292 / 296): the JSONLs pane's rows and the picker's "is this folder empty of what I want" check.
//
// The fixture is two hand-written transcripts with STATED instants — one NESTED, so the recursive walk is proven — whose file order is the OPPOSITE of their chronological order, so the route's ascending sort cannot pass by accidentally echoing walk order.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureViewer } from "./layer1-view-test-helpers.ts";
import { SESSION_A, SESSION_B, buildPromptRecord, buildWriteRecordPair } from "./multi-source-test-helpers.ts";
import type { Layer1WireSession } from "../src/viewer_api_layer1_sessions.ts";

// 17400, 17900, 18400, 18900, 19400, 19900 and 20400 are taken by other server test files — parallel test files must never collide.
const SCRATCH_PORT = 20900 + (process.pid % 500);

const NESTED_STARTED = "2026-07-24T09:00:00.000Z";
const NESTED_ENDED = "2026-07-24T09:30:00.000Z";
const ROOT_STARTED = "2026-07-24T10:00:00.000Z";
const ROOT_ENDED = "2026-07-24T10:05:00.000Z";

function writeJsonlFixture(path: string, records: object[]): void {
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

// a/one.jsonl opens with a Write (so its first `user` record is a TOOL RESULT, proving the title skips those) and is the EARLIER session; two.jsonl sits at the root and is the later one.
function makeSessionsFixture(): { sourceDir: string; onePath: string; twoPath: string } {
    const sourceDir = mkdtempSync(join(tmpdir(), "layer1-sessions-"));
    mkdirSync(join(sourceDir, "a"));
    const onePath = join(sourceDir, "one.py");
    const twoPath = join(sourceDir, "two.py");
    const writeOne = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: sourceDir, timestamp: NESTED_STARTED, toolId: "toolu_sessions_w1", parentUuid: null },
        onePath,
        "one\n",
    );
    writeJsonlFixture(join(sourceDir, "a", "one.jsonl"), [
        ...writeOne.records,
        buildPromptRecord("prompt-one", writeOne.lastUuid, NESTED_ENDED, sourceDir),
    ]);
    const writeTwo = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: sourceDir, timestamp: ROOT_ENDED, toolId: "toolu_sessions_w2", parentUuid: "prompt-two" },
        twoPath,
        "two\n",
    );
    writeJsonlFixture(join(sourceDir, "two.jsonl"), [
        buildPromptRecord("prompt-two", null, ROOT_STARTED, sourceDir, { sessionId: SESSION_B }),
        ...writeTwo.records,
    ]);
    return { sourceDir, onePath, twoPath };
}

const { sourceDir, onePath, twoPath } = makeSessionsFixture();
const emptyDir = mkdtempSync(join(tmpdir(), "layer1-sessions-empty-"));
let child: ChildProcess | undefined = undefined;

before(async () => {
    child = await startFixtureViewer(sourceDir, SCRATCH_PORT);
});

after(() => {
    child?.kill();
});

async function requestSessions(folders: string[]): Promise<Layer1WireSession[]> {
    const query = new URLSearchParams(folders.map((folder) => ["jsonl", folder]));
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/layer1-sessions?${query.toString()}`);
    assert.equal(response.status, 200);
    return (await response.json() as { sessions: Layer1WireSession[] }).sessions;
}

async function requestScanCount(folder: string, kind: string): Promise<number> {
    const query = new URLSearchParams({ path: folder, kind });
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/scan-source?${query.toString()}`);
    assert.equal(response.status, 200);
    return (await response.json() as { found: number }).found;
}

test("test_layer1_sessions_walks_nested_folders_and_sorts_by_start_instant", async () => {
    // Passing the SAME folder twice also proves the de-duplication by absolute path.
    const sessions = await requestSessions([sourceDir, sourceDir]);
    assert.deepEqual(sessions.map((session) => session.file), ["one.jsonl", "two.jsonl"]);
    assert.equal(sessions[0]!.fullPath, join(sourceDir, "a", "one.jsonl"));
});

test("test_layer1_sessions_report_the_first_and_last_record_instants", async () => {
    const sessions = await requestSessions([sourceDir]);
    assert.equal(sessions[0]!.started, NESTED_STARTED);
    assert.equal(sessions[0]!.ended, NESTED_ENDED);
    assert.equal(sessions[1]!.started, ROOT_STARTED);
    assert.equal(sessions[1]!.ended, ROOT_ENDED);
});

test("test_layer1_sessions_list_the_paths_each_session_touched", async () => {
    const sessions = await requestSessions([sourceDir]);
    assert.deepEqual(sessions[0]!.paths, [onePath]);
    assert.deepEqual(sessions[1]!.paths, [twoPath]);
});

test("test_layer1_sessions_title_is_the_first_typed_prompt_not_a_tool_result", async () => {
    // one.jsonl's first `user` record is the Write's tool_result; the title must skip it.
    const sessions = await requestSessions([sourceDir]);
    assert.equal(sessions[0]!.title, "next task");
});

test("test_layer1_sessions_without_a_source_folder_is_a_400", async () => {
    const response = await fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/layer1-sessions`);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /jsonl/);
});

test("test_scan_source_reports_a_hit_for_a_folder_holding_transcripts", async () => {
    assert.ok(await requestScanCount(sourceDir, "jsonl") >= 1);
});

test("test_scan_source_reports_zero_for_a_folder_with_no_transcripts", async () => {
    // The picker refuses a folder on exactly this answer, so it is the load-bearing case.
    assert.equal(await requestScanCount(emptyDir, "jsonl"), 0);
});

test("test_scan_source_counts_every_regular_file_for_the_file_history_kind", async () => {
    // A snapshot store's names are hashes with no common extension, so any regular file counts; only the empty folder can answer 0 for this kind.
    assert.ok(await requestScanCount(sourceDir, "filehistory") >= 1);
    assert.equal(await requestScanCount(emptyDir, "filehistory"), 0);
});

test("test_scan_source_refuses_a_missing_folder_and_an_unknown_kind", async () => {
    const missing = await fetch(
        `http://127.0.0.1:${SCRATCH_PORT}/api/scan-source?path=${encodeURIComponent(join(sourceDir, "nope"))}&kind=jsonl`);
    assert.equal(missing.status, 400);
    const badKind = await fetch(
        `http://127.0.0.1:${SCRATCH_PORT}/api/scan-source?path=${encodeURIComponent(sourceDir)}&kind=zip`);
    assert.equal(badKind.status, 400);
    assert.match(await badKind.text(), /unknown source kind/);
});
