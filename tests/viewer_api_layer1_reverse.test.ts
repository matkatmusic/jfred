// GET /api/layer1-reverse: the reverse walk of one project file, as one JSON body or as NDJSON with ?progress=1.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sendLayer1ReverseResponse } from "../src/viewer_api_layer1_reverse.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

function buildResponseStub(): { response: ServerResponse; body: () => string } {
    let body = "";
    const append = (chunk?: string): void => {
        body += chunk ?? "";
    };
    const response = {
        writeHead: () => response, write: append, end: append, destroyed: false,
        socket: { destroyed: false, writable: true, setNoDelay: () => {}, uncork: () => {} },
    } as unknown as ServerResponse;
    return { response, body: () => body };
}

// A git project with a.txt committed, plus a Claude-home-shaped transcripts folder (projects/p beside file-history) with no transcripts.
function buildProject(): { projectFolder: string; jsonlFolder: string } {
    const projectFolder = createTempDir();
    execFileSync("git", ["init", "-q"], { cwd: projectFolder });
    writeFileSync(join(projectFolder, "a.txt"), "hello");
    execFileSync("git", ["add", "a.txt"], { cwd: projectFolder });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first"], { cwd: projectFolder });
    const claudeHome = createTempDir();
    const jsonlFolder = join(claudeHome, "projects", "p");
    mkdirSync(jsonlFolder, { recursive: true });
    mkdirSync(join(claudeHome, "file-history"));
    return { projectFolder, jsonlFolder };
}

test("test_reverse_route_without_progress_sends_the_walk_as_plain_json", () => {
    // a project file with no transcript rows
    const { projectFolder, jsonlFolder } = buildProject();
    const { response, body } = buildResponseStub();
    // ask for the walk
    sendLayer1ReverseResponse(response, new URLSearchParams({ dir: projectFolder, path: "a.txt", jsonl: jsonlFolder }));
    // one JSON body holds the disk state and the commit that holds the same text
    const states = JSON.parse(body()).states;
    assert.deepEqual(states[0], { index: 0, kind: "DiskNow", content: "hello", isModifying: true });
    assert.deepEqual(states.map((state: { kind: string; isModifying: boolean }) => `${state.kind}:${state.isModifying}`), ["DiskNow:true", "GitCommit:false"]);
});

test("test_reverse_route_answers_a_second_request_from_the_cache_while_the_file_stays_the_same", () => {
    // a project file with no transcript rows, asked once
    const { projectFolder, jsonlFolder } = buildProject();
    const query = new URLSearchParams({ dir: projectFolder, path: "a.txt", jsonl: jsonlFolder });
    const firstStub = buildResponseStub();
    sendLayer1ReverseResponse(firstStub.response, query);
    // a Write row of the file appears, and the file itself does not change
    writeWriteRow(jsonlFolder, "s1.jsonl", "toolu_A", join(projectFolder, "a.txt"), "hello", "old", 5);
    const secondStub = buildResponseStub();
    sendLayer1ReverseResponse(secondStub.response, query);
    // the second answer equals the first
    assert.equal(secondStub.body(), firstStub.body());
    // the file changes size, so the next answer is built again and holds the row
    writeFileSync(join(projectFolder, "a.txt"), "hello again");
    const thirdStub = buildResponseStub();
    sendLayer1ReverseResponse(thirdStub.response, query);
    assert.notEqual(thirdStub.body(), firstStub.body());
});

test("test_reverse_route_with_progress_sends_the_walk_as_one_ndjson_line", () => {
    // a project file with no transcript rows
    const { projectFolder, jsonlFolder } = buildProject();
    const { response, body } = buildResponseStub();
    // ask for the walk with progress
    sendLayer1ReverseResponse(response, new URLSearchParams({ dir: projectFolder, path: "a.txt", jsonl: jsonlFolder, progress: "1" }));
    // the body is one NDJSON line holding the same walk
    const lines = body().split("\n").filter((line) => line !== "");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!).states[0], { index: 0, kind: "DiskNow", content: "hello", isModifying: true });
});

// test("test_reverse_route_uses_the_first_jsonl_folder", () => {
//     // two jsonl values, the first valid and the second not a folder
//     const { projectFolder, jsonlFolder } = buildProject();
//     const query = new URLSearchParams({ dir: projectFolder, path: "a.txt", jsonl: jsonlFolder });
//     query.append("jsonl", join(projectFolder, "missing"));
//     const { response, body } = buildResponseStub();
//     // ask for the walk
//     sendLayer1ReverseResponse(response, query);
//     // the answer comes from the first folder
//     assert.equal(JSON.parse(body()).states[0].kind, "DiskNow");
// });

function writeWriteRow(jsonlFolder: string, fileName: string, toolUseId: string, filePath: string, content: string, originalFile: string, second: number): void {
    const instant = (offsetMilliseconds: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, second) + offsetMilliseconds).toISOString();
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Write", input: { file_path: filePath }, caller: { type: "direct" } }];
    const call = { type: "assistant", uuid: `call-${toolUseId}`, timestamp: instant(-1), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const toolUseResult = { type: "update", filePath, content, originalFile, structuredPatch: [], userModified: false };
    const result = { type: "user", uuid: `result-${toolUseId}`, timestamp: instant(0), message: { role: "user", content: resultContent }, toolUseResult };
    writeFileSync(join(jsonlFolder, fileName), [call, result].map((record) => JSON.stringify(record)).join("\n") + "\n");
}

test("test_reverse_route_uses_every_jsonl_folder", () => {
    // one project file, and one Write row of it in each of two transcript folders
    const { projectFolder, jsonlFolder: firstFolder } = buildProject();
    const { jsonlFolder: secondFolder } = buildProject();
    writeFileSync(join(projectFolder, "a.txt"), "C");
    writeWriteRow(firstFolder, "s1.jsonl", "toolu_A", join(projectFolder, "a.txt"), "B", "A", 5);
    writeWriteRow(secondFolder, "s2.jsonl", "toolu_B", join(projectFolder, "a.txt"), "C", "B", 9);
    const query = new URLSearchParams({ dir: projectFolder, path: "a.txt", jsonl: firstFolder });
    query.append("jsonl", secondFolder);
    const { response, body } = buildResponseStub();
    // ask for the walk
    sendLayer1ReverseResponse(response, query);
    // the response holds the undo of the row from each folder
    const kinds = JSON.parse(body()).states.map((state: { kind: string; content: string }) => `${state.kind}:${state.content}`);
    assert.equal(kinds[0], "DiskNow:C");
    assert.deepEqual(kinds.filter((kind: string) => kind.startsWith("WriteUndone")), ["WriteUndone:B", "WriteUndone:A"]);
});

function writeBackupFile(fileHistoryFolder: string, sessionId: string, backupFileName: string, content: string): void {
    mkdirSync(join(fileHistoryFolder, sessionId), { recursive: true });
    writeFileSync(join(fileHistoryFolder, sessionId, backupFileName), content);
}

test("test_reverse_route_passes_every_snapshots_folder_to_the_walk", () => {
    // a project file, a Write row with no earlier text, and a snapshot row whose backup sits only in the second of two snapshots folders
    const { projectFolder, jsonlFolder } = buildProject();
    const filePath = join(projectFolder, "a.txt");
    writeFileSync(filePath, "D");
    const instant = (second: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
    const snapshot = { type: "file-history-snapshot", messageId: "m1", snapshot: { messageId: "m1", trackedFileBackups: { [filePath]: { backupFileName: "hash@v1", version: 1, backupTime: instant(2) } }, timestamp: instant(0) }, isSnapshotUpdate: false };
    const call = { type: "assistant", uuid: "call-A", timestamp: instant(4), message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_A", name: "Write", input: { file_path: filePath }, caller: { type: "direct" } }] } };
    const result = { type: "user", uuid: "result-A", timestamp: instant(5), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "ok" }] }, toolUseResult: { type: "update", filePath, content: "D", originalFile: null, structuredPatch: [], userModified: false } };
    writeFileSync(join(jsonlFolder, "s1.jsonl"), [snapshot, call, result].map((record) => JSON.stringify(record)).join("\n") + "\n");
    const firstSnapshotsFolder = createTempDir();
    const secondSnapshotsFolder = createTempDir();
    writeBackupFile(secondSnapshotsFolder, "s1", "hash@v1", "C");
    const query = new URLSearchParams({ dir: projectFolder, path: "a.txt", jsonl: jsonlFolder, snapshots: firstSnapshotsFolder });
    query.append("snapshots", secondSnapshotsFolder);
    const { response, body } = buildResponseStub();
    // ask for the walk
    sendLayer1ReverseResponse(response, query);
    // the backup text from the second snapshots folder is a state of the walk
    const kinds = JSON.parse(body()).states.map((state: { kind: string; content: string }) => `${state.kind}:${state.content}`);
    assert.ok(kinds.includes("UnknownChange:C"));
});

test("test_reverse_route_throws_without_a_jsonl_param", () => {
    // no jsonl value
    const { projectFolder } = buildProject();
    const { response } = buildResponseStub();
    // asking throws
    assert.throws(() => sendLayer1ReverseResponse(response, new URLSearchParams({ dir: projectFolder, path: "a.txt" })), /jsonl/);
});

test("test_reverse_route_throws_without_a_path_param", () => {
    // no path value
    const { projectFolder, jsonlFolder } = buildProject();
    const { response } = buildResponseStub();
    // asking throws
    assert.throws(() => sendLayer1ReverseResponse(response, new URLSearchParams({ dir: projectFolder, jsonl: jsonlFolder })), /path/);
});

test("test_reverse_route_throws_for_a_missing_dir", () => {
    // a dir that does not exist
    const { jsonlFolder } = buildProject();
    const { response } = buildResponseStub();
    // asking throws
    assert.throws(() => sendLayer1ReverseResponse(response, new URLSearchParams({ dir: join(jsonlFolder, "nope"), path: "a.txt", jsonl: jsonlFolder })), /dir folder does not exist/);
});

test("test_reverse_route_throws_for_an_absolute_path", () => {
    // an absolute path value
    const { projectFolder, jsonlFolder } = buildProject();
    const { response } = buildResponseStub();
    // asking throws
    assert.throws(() => sendLayer1ReverseResponse(response, new URLSearchParams({ dir: projectFolder, path: join(projectFolder, "a.txt"), jsonl: jsonlFolder })), /absolute/);
});

test("test_reverse_route_throws_for_a_path_that_leaves_the_dir", () => {
    // a path that climbs out of the project folder
    const { projectFolder, jsonlFolder } = buildProject();
    const { response } = buildResponseStub();
    // asking throws
    assert.throws(() => sendLayer1ReverseResponse(response, new URLSearchParams({ dir: projectFolder, path: "../outside.txt", jsonl: jsonlFolder })), /outside/);
});
