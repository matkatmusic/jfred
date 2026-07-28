// An unexplained diff between adjacent verified states is a presumed user edit; the engine never invents an attribution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary.ts";
import {
    buildEndStateNode,
    completeLayer1Timeline,
    insertPresumedUserEditGaps,
} from "../src/layered_end_state.ts";
import { loadLayeredProject } from "../src/layered_load.ts";
import type { BeaconNode, PreAnchorStubNode, ReconstructionEntity } from "../src/layered_types.ts";
import {
    SESSION_A,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

function makeBeacon(instantIso: string, content: string): BeaconNode {
    return { kind: LayeredNodeKind.beacon, instant: new Date(instantIso), content, evidence: undefined };
}

function makeStub(instantIso: string): PreAnchorStubNode {
    return {
        kind: LayeredNodeKind.preAnchorStub,
        instant: new Date(instantIso),
        evidence: { sessionFile: new Path("/fixture/a.jsonl"), line: 1 },
    };
}

test("test_buildEndStateNode_reads_disk_bytes_and_mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    const targetPath = join(dir, "target.py");
    writeFileSync(targetPath, "final bytes\n");
    const node = buildEndStateNode(new Path(targetPath));
    assert.ok(node);
    assert.equal(node?.kind, LayeredNodeKind.endState);
    assert.equal(node?.content, "final bytes\n");
    assert.equal(node?.instant.getTime(), statSync(targetPath).mtime.getTime());
});

test("test_buildEndStateNode_absent_file_yields_undefined", () => {
    // A file no longer on disk has no end state to verify.
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    assert.equal(buildEndStateNode(new Path(join(dir, "never-written.py"))), undefined);
});

test("test_buildEndStateNode_directory_path_yields_undefined", () => {
    // A recorded path can be a DIRECTORY on today's disk (seen in the real jot project).
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    assert.equal(buildEndStateNode(new Path(dir)), undefined);
});

test("test_insertPresumedUserEditGaps_gap_only_between_differing_verified_states", () => {
    // Only an adjacent verified pair with DIFFERING bytes earns a presumption gap.
    const nodes = [
        makeBeacon("2026-07-24T10:01:00.000Z", "x"),
        makeBeacon("2026-07-24T10:02:00.000Z", "x"),
        makeBeacon("2026-07-24T10:03:00.000Z", "y"),
    ];
    const completed = insertPresumedUserEditGaps(nodes);
    assert.equal(completed.length, 4);
    assert.equal(completed[0]?.kind, LayeredNodeKind.beacon);
    assert.equal(completed[1]?.kind, LayeredNodeKind.beacon);
    assert.equal(completed[2]?.kind, LayeredNodeKind.presumedUserEdit);
    assert.equal(completed[2]?.instant.toISOString(), "2026-07-24T10:03:00.000Z");
    assert.equal(completed[3]?.kind, LayeredNodeKind.beacon);
});

test("test_insertPresumedUserEditGaps_skips_byteless_stubs_when_pairing", () => {
    // A byteless stub never blocks or earns a gap — pairing walks verified states only.
    const differing = insertPresumedUserEditGaps([
        makeBeacon("2026-07-24T10:01:00.000Z", "x"),
        makeStub("2026-07-24T10:02:00.000Z"),
        makeBeacon("2026-07-24T10:03:00.000Z", "y"),
    ]);
    assert.deepEqual(
        differing.map((node) => node.kind),
        [
            LayeredNodeKind.beacon,
            LayeredNodeKind.preAnchorStub,
            LayeredNodeKind.presumedUserEdit,
            LayeredNodeKind.beacon,
        ],
    );
    const matching = insertPresumedUserEditGaps([
        makeBeacon("2026-07-24T10:01:00.000Z", "x"),
        makeStub("2026-07-24T10:02:00.000Z"),
        makeBeacon("2026-07-24T10:03:00.000Z", "x"),
    ]);
    assert.deepEqual(
        matching.map((node) => node.kind),
        [LayeredNodeKind.beacon, LayeredNodeKind.preAnchorStub, LayeredNodeKind.beacon],
    );
});

test("test_completeLayer1Timeline_appends_end_state_then_inserts_gaps", () => {
    // The on-disk end state is appended last, then a gap marks its diff from the final beacon.
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    const targetPath = join(dir, "target.py");
    writeFileSync(targetPath, "changed\n");
    const completed = completeLayer1Timeline(
        [makeBeacon("2026-07-24T10:01:00.000Z", "original\n")],
        new Path(targetPath),
    );
    assert.deepEqual(
        completed.map((node) => node.kind),
        [LayeredNodeKind.beacon, LayeredNodeKind.presumedUserEdit, LayeredNodeKind.endState],
    );
});

test("test_loadLayeredProject_session_timeline_ends_with_end_state_and_gap", () => {
    // A loaded timeline whose file exists on disk with different bytes ends with gap plus end state.
    const tree = makeSourceTree("-layered-end-state");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const gammaPath = join(workspaceRoot, "gamma.py");
    const writeGamma = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_end_w1", parentUuid: "prompt-1" },
        gammaPath,
        "line one\n",
    );
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-24T10:00:00.000Z", workspaceRoot),
        ...writeGamma.records,
    ]);
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(gammaPath, "line one\nuser change\n");
    const graph = loadLayeredProject(new Path(tree.projectDir), {});
    const gamma = graph.entities.find(
        (candidate: ReconstructionEntity) => candidate.filename.toString() === gammaPath,
    );
    assert.ok(gamma);
    const nodes = gamma?.sessionTimelines[0]?.timeline.nodes ?? [];
    assert.deepEqual(
        nodes.map((node) => node.kind),
        [LayeredNodeKind.beacon, LayeredNodeKind.presumedUserEdit, LayeredNodeKind.endState],
    );
    const endState = nodes[2];
    assert.equal(endState?.kind === LayeredNodeKind.endState ? endState.content : undefined, "line one\nuser change\n");
});
