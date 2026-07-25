// Server test for task 206 (spec S7/S8 plumbing): GET /api/layered-graph?project=<name>
// serves loadLayeredProject's graph as JSON. Spawned-process pattern (viewer_server.ts listens
// at import time — precedent: tests/viewer_server.test.ts), pointed at a real fixture tree.

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
const PROJECT_NAME = "-layered-api-project";
// A different base than viewer_server.test.ts (17400) so parallel test files never collide.
const SCRATCH_PORT = 17900 + (process.pid % 500);

// One session writing one file — the smallest graph with a beacon to assert on.
function makeFixtureProjectsDir(): { projectsDir: string; alphaPath: string } {
    const tree = makeSourceTree(PROJECT_NAME);
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const alphaPath = join(workspaceRoot, "alpha.py");
    const write = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_api_w1", parentUuid: "prompt-1" },
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

// The wire form of the graph: Path/Uuid serialize via toJSON to strings, Dates to ISO strings.
type WireGraph = {
    entities: Array<{
        filename: string;
        sessionTimelines: Array<{ sessionFile: string; timeline: { nodes: Array<{ kind: string; instant: string; content?: string }> } }>;
    }>;
    renames: unknown[];
    copies: unknown[];
    scriptLinks: unknown[];
    axisOffsetsPx: Record<string, number>;
};

test("test_layered_graph_endpoint_returns_the_fixture_graph_json", async () => {
    const fixture = makeFixtureProjectsDir();
    const child = spawnViewerProcess(fixture.projectsDir);
    try {
        await waitUntilListening(child);
        const response = await fetch(
            `http://127.0.0.1:${SCRATCH_PORT}/api/layered-graph?project=${encodeURIComponent(PROJECT_NAME)}`,
        );
        assert.equal(response.status, 200);
        const graph = await response.json() as WireGraph;
        // one entity: the written file, holding session A's single write beacon.
        assert.equal(graph.entities.length, 1);
        assert.equal(graph.entities[0]!.filename, fixture.alphaPath);
        assert.equal(graph.entities[0]!.sessionTimelines.length, 1);
        assert.ok(graph.entities[0]!.sessionTimelines[0]!.sessionFile.endsWith("a.jsonl"));
        const nodes = graph.entities[0]!.sessionTimelines[0]!.timeline.nodes;
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0]!.kind, "beacon");
        assert.equal(nodes[0]!.content, "line one\n");
        // typed edges stay empty at S1.
        assert.deepEqual(graph.renames, []);
        assert.deepEqual(graph.copies, []);
        assert.deepEqual(graph.scriptLinks, []);
        // task 239 (spec S18): the shared ruler travels with the graph, keyed by the SAME ISO text
        // the nodes carry — that key agreement is the whole contract, since the page looks an
        // offset up by a node's `instant` string. The earliest instant sits at the origin; the
        // capped-gap arithmetic itself is covered by tests/layer1_ruler_axis.test.ts.
        assert.deepEqual(graph.axisOffsetsPx, { [nodes[0]!.instant]: 0 });
    } finally {
        child.kill();
    }
});
