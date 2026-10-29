// Task 357 step 5: GET /api/layer1-branches answers NDJSON progress then the view, or one plain JSON body.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES } from "../src/layer1_branches_wire.ts";
import { sendLayer1BranchesResponse } from "../src/viewer_api_layer1_branches.ts";
import { SESSION_A, buildPromptRecord, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";
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

// One session whose prompt p0 has two prompt children: the earlier one writes f.txt and is abandoned.
function writeRewoundSession(projectFolder: string): string {
    const tree = createSourceTree("-branches-route");
    const envelope = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w1", parentUuid: "p1" };
    const abandoned = buildWriteRecordPair(envelope, `${projectFolder}/f.txt`, "abandoned\n");
    const kept = buildWriteRecordPair({ ...envelope, toolId: "toolu_w2", timestamp: "2026-07-24T10:06:00.000Z", parentUuid: "p2" }, `${projectFolder}/f.txt`, "kept\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("p0", null, "2026-07-24T10:00:00.000Z", projectFolder),
        buildPromptRecord("p1", "p0", "2026-07-24T10:01:30.000Z", projectFolder),
        ...abandoned.records,
        buildPromptRecord("p2", "p0", "2026-07-24T10:05:00.000Z", projectFolder),
        ...kept.records,
        { type: "last-prompt", sessionId: SESSION_A },
    ]);
    return tree.projectDir;
}

function buildQuery(projectFolder: string, jsonlFolders: string[], progress: boolean): URLSearchParams {
    const query = new URLSearchParams({ dir: projectFolder });
    jsonlFolders.forEach((folder) => query.append("jsonl", folder));
    if (progress) {
        query.set("progress", "1");
    }
    return query;
}

type BranchesPayload = { pairs: { path: string; branches: { rewindKind: string; forkAt: string; nodes: { changeId: string; label: string }[] }[] }[] };

test("test_branches_route_streams_progress_then_view", () => {
    const projectFolder = createTempDir();
    const { response, body } = buildResponseStub();
    sendLayer1BranchesResponse(response, buildQuery(projectFolder, [writeRewoundSession(projectFolder)], true));
    const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines.slice(0, 2), [
        { kind: "progress", label: LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, current: 1, total: 1 },
        { kind: "progress", label: LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, current: 1, total: 1 },
    ]);
    const terminal = lines.at(-1) as unknown as BranchesPayload;
    assert.equal(terminal.pairs[0]!.path, "f.txt");
    assert.equal(terminal.pairs[0]!.branches[0]!.rewindKind, "code");
});

test("test_branches_route_without_progress_sends_plain_json", () => {
    const projectFolder = createTempDir();
    const { response, body } = buildResponseStub();
    sendLayer1BranchesResponse(response, buildQuery(projectFolder, [writeRewoundSession(projectFolder)], false));
    const payload = JSON.parse(body()) as BranchesPayload;
    assert.equal(payload.pairs[0]!.branches[0]!.forkAt, "2026-07-24T10:00:00.000Z");
    assert.deepEqual(payload.pairs[0]!.branches[0]!.nodes.map((node) => [node.changeId, node.label]), [["toolu_w1", "write"]]);
});

test("test_branches_route_missing_dir_throws", () => {
    const { response } = buildResponseStub();
    assert.throws(() => sendLayer1BranchesResponse(response, new URLSearchParams()), /missing query param: dir/);
});
