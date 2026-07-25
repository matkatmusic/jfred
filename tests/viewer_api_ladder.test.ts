// Server tests for task 183 (per-file debug viewer): GET /api/file-ladder?project=<name> lists
// the reconstructable final paths; adding &file=<path> serves that file's revision ladder from
// the merged multi-source reconstruction. Spawned-process pattern (viewer_server.ts listens at
// import time — precedent: tests/viewer_api_layered.test.ts), pointed at a real fixture tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import {
    SESSION_A,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PROJECT_NAME = "-ladder-api-project";
// A different base than viewer_api_layered.test.ts (17900) so parallel test files never collide.
const SCRATCH_PORT = 18400 + (process.pid % 500);

// One session writing one file — the smallest project with a one-revision ladder.
function makeFixtureProjectsDir(): { projectsDir: string; alphaPath: string } {
    const tree = makeSourceTree(PROJECT_NAME);
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const alphaPath = join(workspaceRoot, "alpha.py");
    const write = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_ladder_w1", parentUuid: "prompt-1" },
        alphaPath,
        "line one\n",
    );
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-24T10:00:00.000Z", workspaceRoot),
        ...write.records,
    ]);
    return { projectsDir: join(tree.treeRoot, "projects"), alphaPath };
}

function spawnViewerProcess(projectsDir: string): ChildProcess {
    return spawn(process.execPath, [
        "--import", "tsx", "src/viewer_server.ts",
        "--projects-dir", projectsDir,
        "--port", String(SCRATCH_PORT),
    ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "inherit"] });
}

// Signal readiness the way the server announces it: the "viewer listening" stdout line.
function markWhenListeningLineArrives(chunk: Buffer, markListening: () => void): void {
    if (chunk.toString().includes("viewer listening")) {
        markListening();
    }
}

function waitUntilListening(child: ChildProcess): Promise<void> {
    return new Promise((resolveStarted, rejectStarted) => {
        child.stdout?.on("data", (chunk: Buffer) => markWhenListeningLineArrives(chunk, resolveStarted));
        child.on("exit", (code) => rejectStarted(new Error(`server exited early: ${code}`)));
    });
}

function fetchLadderRoute(query: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${SCRATCH_PORT}/api/file-ladder?project=${encodeURIComponent(PROJECT_NAME)}${query}`);
}

// The wire form of a FileHistory: Path/Uuid serialize via toJSON, Dates to ISO strings; each
// LineEntry carries its sighting history — the LAST value is the line's content at this revision.
type WireLadder = {
    target: string;
    revisions: Array<{ kind: string; lines: Array<{ values: Array<{ line: string }> }> }>;
};

test("test_file_ladder_endpoint_lists_final_paths", async () => {
    // Scenario: without a file param the endpoint lists the project's reconstructable final paths.
    // Steps:
    // spawn the server over the one-write fixture and ask for the list.
    const fixture = makeFixtureProjectsDir();
    const child = spawnViewerProcess(fixture.projectsDir);
    try {
        await waitUntilListening(child);
        const response = await fetchLadderRoute("");
        assert.equal(response.status, 200);
        // exactly the written file appears.
        const listing = await response.json() as { files: string[] };
        assert.deepEqual(listing.files, [fixture.alphaPath]);
    } finally {
        child.kill();
    }
});

test("test_file_ladder_endpoint_returns_one_files_revision_ladder", async () => {
    // Scenario: with &file= the endpoint serves that file's FileHistory from the merged
    // multi-source reconstruction (surviving-branch fast path).
    // Steps:
    // spawn the server and request alpha.py's ladder.
    const fixture = makeFixtureProjectsDir();
    const child = spawnViewerProcess(fixture.projectsDir);
    try {
        await waitUntilListening(child);
        const response = await fetchLadderRoute(`&file=${encodeURIComponent(fixture.alphaPath)}`);
        assert.equal(response.status, 200);
        const ladder = await response.json() as WireLadder;
        // the ladder targets the requested file and holds the single write revision.
        assert.equal(ladder.target, fixture.alphaPath);
        assert.equal(ladder.revisions.length, 1);
        assert.equal(ladder.revisions[0]!.kind, "write");
        // the revision's lines carry the written content (each line's latest sighting).
        assert.deepEqual(
            ladder.revisions[0]!.lines.map((line) => line.values.at(-1)?.line),
            ["line one"],
        );
    } finally {
        child.kill();
    }
});

test("test_file_ladder_endpoint_refuses_an_unknown_file", async () => {
    // Scenario: a file the reconstruction never exposes as a final path is a 400 refusal, not an
    // empty ladder.
    // Steps:
    // spawn the server and request a path with no evidence.
    const fixture = makeFixtureProjectsDir();
    const child = spawnViewerProcess(fixture.projectsDir);
    try {
        await waitUntilListening(child);
        const response = await fetchLadderRoute(`&file=${encodeURIComponent("/no/such/file.py")}`);
        assert.equal(response.status, 400);
    } finally {
        child.kill();
    }
});
