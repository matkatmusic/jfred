// GET /api/layer1-inverse-repos answers NDJSON: a step plan line, one progress line per file, then the result line.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS } from "../src/layer1_inverse_repos_wire.ts";
import { Path } from "../src/structures/domain.ts";
import { getInverseReposStoreFolder, sendLayer1InverseReposResponse } from "../src/viewer_api_layer1_inverse_repos.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
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

// A project folder holding a.py and sub/b.py, plus a log folder whose Write rows name both.
function buildQueryForProjectWithLogs(progress: boolean): URLSearchParams {
    const projectFolder = createTempDir();
    mkdirSync(join(projectFolder, "sub"));
    writeFileSync(join(projectFolder, "a.py"), "one\n");
    writeFileSync(join(projectFolder, "sub", "b.py"), "two\n");
    const tree = createSourceTree("-inverse-repos-route");
    const envelopeA = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
    const envelopeB = { ...envelopeA, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
    const writeA = buildWriteRecordPair(envelopeA, join(projectFolder, "a.py"), "one\n");
    const writeB = buildWriteRecordPair(envelopeB, join(projectFolder, "sub", "b.py"), "two\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeA.records, ...writeB.records]);
    const query = new URLSearchParams({ dir: projectFolder });
    query.append("jsonl", tree.projectDir);
    query.append("snapshots", join(tree.treeRoot, "file-history"));
    if (progress) {
        query.set("progress", "1");
    }
    return query;
}

test("test_inverse_repos_route_streams_plan_then_progress_then_result", () => {
    const query = buildQueryForProjectWithLogs(true);
    const { response, body } = buildResponseStub();
    rmSync(getInverseReposStoreFolder(new Path(query.get("dir")!)).toString(), { recursive: true, force: true });
    sendLayer1InverseReposResponse(response, query);
    rmSync(getInverseReposStoreFolder(new Path(query.get("dir")!)).toString(), { recursive: true, force: true });
    const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines[0], { kind: "progress", label: LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS, current: 0, total: 2, steps: [LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS] });
    assert.equal(lines.length, 4);
    assert.equal(lines[1]!["kind"], "progress");
    assert.equal(lines[1]!["current"], 1);
    assert.equal(lines[2]!["current"], 2);
    const result = lines[3] as { files: { file: string; commits: unknown[] }[] };
    assert.deepEqual(result.files.map((fileWire) => fileWire.file), ["a.py", "sub/b.py"]);
});

test("test_inverse_repos_route_without_dir_throws", () => {
    const { response } = buildResponseStub();
    assert.throws(() => sendLayer1InverseReposResponse(response, new URLSearchParams()), /missing query param: dir/);
});
