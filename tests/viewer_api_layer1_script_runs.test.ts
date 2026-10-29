// Task l4-wire-real: GET /api/layer1-script-runs answers NDJSON progress then the view, or one plain JSON body.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS } from "../src/layer1_script_runs_wire.ts";
import { sendLayer1ScriptRunsResponse } from "../src/viewer_api_layer1_script_runs.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
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

function makeProjectFolder(): string {
    const projectFolder = createTempDir();
    writeFileSync(join(projectFolder, "a.py"), "one\n");
    return projectFolder;
}

function writeSessionFolder(projectFolder: string): string {
    const tree = createSourceTree("-script-runs-route");
    const bashRecord = {
        type: "assistant", uuid: "toolu_b1-assistant", parentUuid: null, sessionId: SESSION_A,
        timestamp: "2026-07-24T10:01:00.000Z", cwd: projectFolder,
        message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_b1", name: "Bash", input: { command: "sed -i '' 's/a/b/' a.py" } }] },
    };
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [bashRecord]);
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

test("test_script_runs_route_streams_progress_then_view", () => {
    const projectFolder = makeProjectFolder();
    const { response, body } = buildResponseStub();
    sendLayer1ScriptRunsResponse(response, buildQuery(projectFolder, [writeSessionFolder(projectFolder)], true));
    const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines[0], { kind: "progress", label: LAYER1_PROGRESS_LABEL_READING_SCRIPT_RUNS, current: 1, total: 1 });
    const terminal = lines.at(-1) as { pairs: { path: string; scriptRuns: { executorKind: string }[] }[] };
    assert.equal(terminal.pairs[0]!.path, "a.py");
    assert.equal(terminal.pairs[0]!.scriptRuns[0]!.executorKind, "bash");
});

test("test_script_runs_route_without_progress_sends_plain_json", () => {
    const projectFolder = makeProjectFolder();
    const { response, body } = buildResponseStub();
    sendLayer1ScriptRunsResponse(response, buildQuery(projectFolder, [writeSessionFolder(projectFolder)], false));
    const payload = JSON.parse(body()) as { pairs: { path: string; scriptRuns: Record<string, unknown>[] }[] };
    assert.equal(payload.pairs[0]!.scriptRuns[0]!["toolUseId"], "toolu_b1");
});

test("test_script_runs_route_ignores_workflow_journal", () => {
    for (const progress of [false, true]) {
        const projectFolder = makeProjectFolder();
        const jsonlFolder = writeSessionFolder(projectFolder);
        const workflowFolder = join(jsonlFolder, "subagents", "workflows", "wf_x");
        mkdirSync(workflowFolder, { recursive: true });
        writeFileSync(join(workflowFolder, "journal.jsonl"), '{"type":"launched"}\n');
        const { response, body } = buildResponseStub();
        sendLayer1ScriptRunsResponse(response, buildQuery(projectFolder, [jsonlFolder], progress));
        const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
        assert.equal(lines.some((line) => line["kind"] === "error"), false);
        assert.equal((lines.at(-1) as { pairs: { path: string }[] }).pairs[0]!.path, "a.py");
    }
});

test("test_script_runs_route_missing_dir_throws", () => {
    const { response } = buildResponseStub();
    assert.throws(() => sendLayer1ScriptRunsResponse(response, new URLSearchParams()), /missing query param: dir/);
});
