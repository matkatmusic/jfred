// GET /api/layer1-inverse-repos answers NDJSON: a step plan line, one progress line per file, then the result line.

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
// import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    execFileSync("git", ["init", "-q"], { cwd: projectFolder });
    // The layered search runs git merge-base against HEAD, so the repo needs one commit.
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: projectFolder });
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
    // Per-file step events carry no current; this test checks the plan, the per-file events and the result.
    const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line["logFile"] === undefined).filter((line) => !String(line["label"]).startsWith("searching logs:")).filter((line) => line["buildingFile"] === undefined).filter((line) => line["fileStepsDone"] === undefined || line["current"] !== undefined);
    assert.deepEqual(lines[0], { kind: "progress", label: LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS, current: 0, total: 2, steps: [LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS] });
    assert.equal(lines.length, 4);
    assert.equal(lines[1]!["kind"], "progress");
    assert.equal(lines[1]!["current"], 1);
    assert.equal(lines[2]!["current"], 2);
    const result = lines[3] as { files: { file: string; commits: unknown[] }[] };
    assert.deepEqual(result.files.map((fileWire) => fileWire.file), ["a.py", "sub/b.py"]);
});

// Obsolete: the layered search no longer sends one logFile line per session log.
// test("test_inverse_repos_route_streams_one_log_file_line_per_session_log_before_the_plan", () => {
//     const query = buildQueryForProjectWithLogs(true);
//     const { response, body } = buildResponseStub();
//     rmSync(getInverseReposStoreFolder(new Path(query.get("dir")!)).toString(), { recursive: true, force: true });
//     sendLayer1InverseReposResponse(response, query);
//     rmSync(getInverseReposStoreFolder(new Path(query.get("dir")!)).toString(), { recursive: true, force: true });
//     const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
//     // The lines before the plan line are one logFile line per .jsonl of the log folder.
//     const planIndex = lines.findIndex((line) => line["label"] === LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS);
//     const logFileNames = readdirSync(query.get("jsonl")!).filter((name) => name.endsWith(".jsonl"));
//     assert.deepEqual(lines.slice(0, planIndex), logFileNames.map((name) => ({ kind: "progress", label: name, logFile: name })));
//     assert.equal(logFileNames.length > 0, true);
//     for (const line of lines.slice(0, planIndex)) {
//         assert.equal(String(line["logFile"]).includes("/"), false);
//     }
// });

test("test_inverse_repos_route_streams_searching_logs_progress_lines_before_the_plan", () => {
    // Scenario: the route streams "searching logs:" progress lines before the plan line.
    // Build a project folder with a log folder, and ask the route for progress.
    const query = buildQueryForProjectWithLogs(true);
    const { response, body } = buildResponseStub();
    rmSync(getInverseReposStoreFolder(new Path(query.get("dir")!)).toString(), { recursive: true, force: true });
    // Run the route.
    sendLayer1InverseReposResponse(response, query);
    rmSync(getInverseReposStoreFolder(new Path(query.get("dir")!)).toString(), { recursive: true, force: true });
    const lines = body().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);
    // Find the plan line.
    const planIndex = lines.findIndex((line) => line["label"] === LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS);
    assert.equal(planIndex > 0, true);
    // At least one line before the plan line is a progress line labeled "searching logs:".
    const searchingLogsLines = lines.slice(0, planIndex).filter((line) => line["kind"] === "progress" && String(line["label"]).startsWith("searching logs:"));
    assert.equal(searchingLogsLines.length >= 1, true);
});

test("test_inverse_repos_route_without_dir_throws", () => {
    const { response } = buildResponseStub();
    assert.throws(() => sendLayer1InverseReposResponse(response, new URLSearchParams()), /missing query param: dir/);
});
