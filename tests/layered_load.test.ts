// Task 196 (spec S1): loadLayeredProject — source discovery (explicit paths win) and per-file
// ReconstructionEntitys with per-session SessionTimelines built from JSONL rows. Fixtures are
// fabricated wire records loaded through loadTranscript (multi-source-test-helpers), never
// hand-cast objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary.ts";
import {
    discoverJsonlPaths,
    loadLayeredProject,
    resolveEvidenceRoots,
} from "../src/layered_load.ts";
import type { ReconstructionEntity } from "../src/layered_types.ts";
import {
    SESSION_A,
    SESSION_B,
    buildEditRecordPair,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

type LayeredFixture = {
    projectDir: string;
    treeRoot: string;
    workspaceRoot: string;
    alphaPath: string;
    betaPath: string;
    sessionARecords: import("../src/structures/envelope.ts").TranscriptRecord[];
};

// Two sessions in ONE project folder: session A (a.jsonl) writes then edits alpha.py;
// session B (b.jsonl) writes beta.py.
function makeLayeredFixture(): LayeredFixture {
    const tree = makeSourceTree("-layered-project");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const alphaPath = join(workspaceRoot, "alpha.py");
    const betaPath = join(workspaceRoot, "beta.py");
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_layered_w1", parentUuid: "prompt-1" },
        alphaPath,
        "line one\n",
    );
    const editAlpha = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_layered_e1", parentUuid: writeAlpha.lastUuid },
        alphaPath,
        "line one\nline two\n",
        "line one\n",
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
    );
    const sessionARecords = writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-24T10:00:00.000Z", workspaceRoot),
        ...writeAlpha.records,
        ...editAlpha.records,
    ]);
    const writeBeta = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: workspaceRoot, timestamp: "2026-07-24T10:03:00.000Z", toolId: "toolu_layered_w2", parentUuid: null },
        betaPath,
        "beta line\n",
    );
    writeTranscriptFixture(tree.projectDir, "b.jsonl", writeBeta.records);
    return { projectDir: tree.projectDir, treeRoot: tree.treeRoot, workspaceRoot, alphaPath, betaPath, sessionARecords };
}

// The entity whose filename matches `target`, asserting it exists.
function findEntity(entities: ReconstructionEntity[], target: string): ReconstructionEntity {
    const entity = entities.find((candidate) => candidate.filename.toString() === target);
    assert.ok(entity, `no entity for ${target}`);
    return entity;
}

test("test_discoverJsonlPaths_scans_top_level_jsonl_files", () => {
    // Scenario: with no override, discovery lists the folder's top-level .jsonl files, name-sorted.
    // Steps:
    // a project folder holding a.jsonl and b.jsonl plus a non-jsonl file.
    const fixture = makeLayeredFixture();
    writeFileSync(join(fixture.projectDir, "notes.txt"), "not a transcript\n");
    // discovery returns exactly the two jsonls in name order.
    const discovered = discoverJsonlPaths(new Path(fixture.projectDir), undefined);
    assert.deepEqual(
        discovered.map((path) => path.toString()),
        [join(fixture.projectDir, "a.jsonl"), join(fixture.projectDir, "b.jsonl")],
    );
});

test("test_discoverJsonlPaths_override_wins_over_folder_scan", () => {
    // Scenario: an explicit jsonlPaths override is returned verbatim — the folder is not scanned.
    // Steps:
    // a folder with two jsonls but an override naming one unrelated path.
    const fixture = makeLayeredFixture();
    const override = [new Path("/somewhere/else/c.jsonl")];
    // the override comes back untouched.
    const discovered = discoverJsonlPaths(new Path(fixture.projectDir), override);
    assert.deepEqual(discovered, override);
});

test("test_resolveEvidenceRoots_explicit_paths_win", () => {
    // Scenario: explicit repoPath/snapshotPaths overrides are returned unchanged.
    // Steps:
    // records exist but overrides name both roots.
    const fixture = makeLayeredFixture();
    const repoOverride = new Path("/explicit/repo");
    const snapshotOverride = [new Path("/explicit/file-history")];
    const roots = resolveEvidenceRoots(fixture.sessionARecords, { repoPath: repoOverride, snapshotPaths: snapshotOverride });
    // both overrides win.
    assert.equal(roots.repoPath, repoOverride);
    assert.deepEqual(roots.snapshotPaths, snapshotOverride);
});

test("test_resolveEvidenceRoots_discovers_from_records_without_overrides", () => {
    // Scenario: without overrides, the repo root falls back to the records' first cwd and the
    // snapshot root to the transcript-derived sibling file-history directory.
    // Steps:
    // records loaded from the fixture tree (source-stamped by loadTranscript).
    const fixture = makeLayeredFixture();
    const roots = resolveEvidenceRoots(fixture.sessionARecords, {});
    // repo root = the recorded cwd; snapshot root = the sibling file-history dir.
    assert.equal(roots.repoPath?.toString(), fixture.workspaceRoot);
    assert.deepEqual(
        roots.snapshotPaths.map((path) => path.toString()),
        [join(fixture.treeRoot, "file-history")],
    );
});

test("test_loadLayeredProject_yields_one_entity_per_evidenced_file", () => {
    // Scenario: the graph holds exactly one entity per evidenced absolute path, each holding its
    // owning session's timeline with nodes in instant order.
    // Steps:
    // load the two-session fixture folder.
    const fixture = makeLayeredFixture();
    const graph = loadLayeredProject(new Path(fixture.projectDir), {});
    // exactly the two evidenced files appear.
    assert.equal(graph.entities.length, 2);
    // alpha's entity holds ONE session timeline (session A): the write beacon, then the edit —
    // ALSO a beacon since task 198 (its populated originalFile is full-content evidence).
    const alpha = findEntity(graph.entities, fixture.alphaPath);
    assert.equal(alpha.sessionTimelines.length, 1);
    const alphaNodes = alpha.sessionTimelines[0].timeline.nodes;
    assert.equal(alphaNodes.length, 2);
    assert.equal(alphaNodes[0].kind, LayeredNodeKind.beacon);
    assert.equal(alphaNodes[1].kind, LayeredNodeKind.beacon);
    assert.ok(alphaNodes[0].instant.getTime() < alphaNodes[1].instant.getTime());
    // beta's entity holds session B's single write beacon.
    const beta = findEntity(graph.entities, fixture.betaPath);
    assert.equal(beta.sessionTimelines.length, 1);
    assert.equal(beta.sessionTimelines[0].timeline.nodes.length, 1);
    assert.equal(beta.sessionTimelines[0].timeline.nodes[0].kind, LayeredNodeKind.beacon);
    // typed edges are S6 territory — S1 leaves them empty.
    assert.deepEqual(graph.renames, []);
    assert.deepEqual(graph.copies, []);
    assert.deepEqual(graph.scriptLinks, []);
});

test("test_loadLayeredProject_explicit_jsonl_override_limits_sources", () => {
    // Scenario: an explicit jsonlPaths override restricts loading to the named sessions.
    // Steps:
    // load with only session A's jsonl.
    const fixture = makeLayeredFixture();
    const graph = loadLayeredProject(new Path(fixture.projectDir), {
        jsonlPaths: [new Path(join(fixture.projectDir, "a.jsonl"))],
    });
    // beta.py (evidenced only by session B) is absent.
    assert.equal(graph.entities.length, 1);
    assert.equal(graph.entities[0].filename.toString(), fixture.alphaPath);
});

test("test_loadLayeredProject_beacon_carries_write_content_and_evidence_line", () => {
    // Scenario: a Write row becomes a beacon holding the written bytes and a JsonlRef naming its
    // session file and source line.
    // Steps:
    // load the fixture and take alpha's first node.
    const fixture = makeLayeredFixture();
    const graph = loadLayeredProject(new Path(fixture.projectDir), {});
    const alpha = findEntity(graph.entities, fixture.alphaPath);
    const beacon = alpha.sessionTimelines[0].timeline.nodes[0];
    assert.equal(beacon.kind, LayeredNodeKind.beacon);
    if (beacon.kind !== LayeredNodeKind.beacon) {
        return;
    }
    // the beacon holds the Write body and points at a real line of a.jsonl.
    assert.equal(beacon.content, "line one\n");
    assert.ok(beacon.evidence);
    assert.equal(beacon.evidence?.sessionFile.toString(), join(fixture.projectDir, "a.jsonl"));
    assert.ok((beacon.evidence?.line ?? 0) > 0);
});
