// Task 355 step 6: GET /api/layer1-edits answers NDJSON progress then the view, or one plain JSON body.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { LAYER1_PROGRESS_LABEL_READING_EDITS } from "../src/layer1_edits_wire.ts";
import { handleLayer1EditsRequest } from "../src/viewer_api_layer1_edits.ts";
import {
    SESSION_A, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

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

function writeSessionFolder(projectFolder: string): string {
    const tree = makeSourceTree("-edits-route");
    const envelope = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
    writeTranscriptFixture(tree.projectDir, "a.jsonl", buildWriteRecordPair(envelope, join(projectFolder, "a.py"), "one\n").records);
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

test("test_edits_route_streams_progress_then_view", () => {
    const projectFolder = makeTempDir();
    const { response, body } = buildResponseStub();
    handleLayer1EditsRequest(response, buildQuery(projectFolder, [writeSessionFolder(projectFolder)], true));
    const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines[0], { kind: "progress", label: LAYER1_PROGRESS_LABEL_READING_EDITS, current: 1, total: 1 });
    const terminal = lines.at(-1) as { pairs: { path: string; edits: { kind: string }[] }[] };
    assert.equal(terminal.pairs[0]!.path, "a.py");
    assert.equal(terminal.pairs[0]!.edits[0]!.kind, "write");
});

test("test_edits_route_without_progress_sends_plain_json", () => {
    const projectFolder = makeTempDir();
    const { response, body } = buildResponseStub();
    handleLayer1EditsRequest(response, buildQuery(projectFolder, [writeSessionFolder(projectFolder)], false));
    const payload = JSON.parse(body()) as { pairs: { path: string; edits: Record<string, unknown>[] }[] };
    assert.equal(payload.pairs[0]!.edits[0]!["confidence"], "verified");
    assert.equal(payload.pairs[0]!.edits[0]!["changeId"], "toolu_w1");
});

test("test_edits_route_ignores_workflow_journal", () => {
    for (const progress of [false, true]) {
        const projectFolder = makeTempDir();
        const jsonlFolder = writeSessionFolder(projectFolder);
        const workflowFolder = join(jsonlFolder, "subagents", "workflows", "wf_x");
        mkdirSync(workflowFolder, { recursive: true });
        writeFileSync(join(workflowFolder, "journal.jsonl"), '{"type":"launched"}\n');
        const { response, body } = buildResponseStub();
        handleLayer1EditsRequest(response, buildQuery(projectFolder, [jsonlFolder], progress));
        const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
        assert.equal(lines.some((line) => line["kind"] === "error"), false);
        assert.equal((lines.at(-1) as { pairs: { path: string }[] }).pairs[0]!.path, "a.py");
    }
});

test("test_edits_route_missing_dir_throws", () => {
    const { response } = buildResponseStub();
    assert.throws(() => handleLayer1EditsRequest(response, new URLSearchParams()), /missing query param: dir/);
});

test("test_edits_route_zero_jsonl_yields_empty_pairs", () => {
    const { response, body } = buildResponseStub();
    handleLayer1EditsRequest(response, buildQuery(makeTempDir(), [], false));
    assert.deepEqual(JSON.parse(body()), { pairs: [] });
});
