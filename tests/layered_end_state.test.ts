// Task 199 (spec S2): layer-1 timeline completion — the on-disk end state as the final node,
// and presumed-user-edit gaps between adjacent verified states with differing content (Q8:
// unexplained diff = presumed user edit; the engine never invents an attribution).

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

// A beacon literal for the pure-function tests (typed domain object, not a wire record).
function makeBeacon(instantIso: string, content: string): BeaconNode {
    return { kind: LayeredNodeKind.beacon, instant: new Date(instantIso), content, evidence: undefined };
}

// A byteless pre-anchor stub literal.
function makeStub(instantIso: string): PreAnchorStubNode {
    return {
        kind: LayeredNodeKind.preAnchorStub,
        instant: new Date(instantIso),
        evidence: { sessionFile: new Path("/fixture/a.jsonl"), line: 1 },
    };
}

test("test_buildEndStateNode_reads_disk_bytes_and_mtime", () => {
    // Scenario: an existing file becomes an end-state node holding its bytes at its disk mtime.
    // Steps:
    // a real file on disk with known bytes.
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    const targetPath = join(dir, "target.py");
    writeFileSync(targetPath, "final bytes\n");
    // the node carries the end-state kind, the disk bytes, and the disk mtime as its instant.
    const node = buildEndStateNode(new Path(targetPath));
    assert.ok(node);
    assert.equal(node?.kind, LayeredNodeKind.endState);
    assert.equal(node?.content, "final bytes\n");
    assert.equal(node?.instant.getTime(), statSync(targetPath).mtime.getTime());
});

test("test_buildEndStateNode_absent_file_yields_undefined", () => {
    // Scenario: a file no longer on disk has no end state to verify.
    // Steps:
    // a path inside a fresh tmp dir that was never written.
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    // no node is fabricated for it.
    assert.equal(buildEndStateNode(new Path(join(dir, "never-written.py"))), undefined);
});

test("test_buildEndStateNode_directory_path_yields_undefined", () => {
    // Scenario: a recorded path can be a DIRECTORY on today's disk (seen in the real jot
    // project) — a directory has no file bytes, so no end-state node is fabricated.
    // Steps:
    // a tmp dir standing at the recorded path.
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    // no node is fabricated for it.
    assert.equal(buildEndStateNode(new Path(dir)), undefined);
});

test("test_insertPresumedUserEditGaps_gap_only_between_differing_verified_states", () => {
    // Scenario: only an adjacent verified pair with DIFFERING bytes earns a presumption gap.
    // Steps:
    // three beacons: equal, equal, then changed.
    const nodes = [
        makeBeacon("2026-07-24T10:01:00.000Z", "x"),
        makeBeacon("2026-07-24T10:02:00.000Z", "x"),
        makeBeacon("2026-07-24T10:03:00.000Z", "y"),
    ];
    const completed = insertPresumedUserEditGaps(nodes);
    // one gap appears, immediately before the differing beacon, at that beacon's instant.
    assert.equal(completed.length, 4);
    assert.equal(completed[0]?.kind, LayeredNodeKind.beacon);
    assert.equal(completed[1]?.kind, LayeredNodeKind.beacon);
    assert.equal(completed[2]?.kind, LayeredNodeKind.presumedUserEdit);
    assert.equal(completed[2]?.instant.toISOString(), "2026-07-24T10:03:00.000Z");
    assert.equal(completed[3]?.kind, LayeredNodeKind.beacon);
});

test("test_insertPresumedUserEditGaps_skips_byteless_stubs_when_pairing", () => {
    // Scenario: a byteless stub between two verified states never blocks (or earns) a gap —
    // pairing walks verified states only.
    // Steps:
    // beacon "x", stub, beacon "y": the pair (x, y) differs.
    const differing = insertPresumedUserEditGaps([
        makeBeacon("2026-07-24T10:01:00.000Z", "x"),
        makeStub("2026-07-24T10:02:00.000Z"),
        makeBeacon("2026-07-24T10:03:00.000Z", "y"),
    ]);
    // the gap lands between the stub and the later beacon.
    assert.deepEqual(
        differing.map((node) => node.kind),
        [
            LayeredNodeKind.beacon,
            LayeredNodeKind.preAnchorStub,
            LayeredNodeKind.presumedUserEdit,
            LayeredNodeKind.beacon,
        ],
    );
    // beacon "x", stub, beacon "x": the pair matches — no gap.
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
    // Scenario: completion appends the on-disk end state as the FINAL node, then a gap marks
    // the unexplained diff between the last beacon and the disk bytes.
    // Steps:
    // a real file whose bytes differ from the sole beacon's.
    const dir = mkdtempSync(join(tmpdir(), "layered-end-state-"));
    const targetPath = join(dir, "target.py");
    writeFileSync(targetPath, "changed\n");
    const completed = completeLayer1Timeline(
        [makeBeacon("2026-07-24T10:01:00.000Z", "original\n")],
        new Path(targetPath),
    );
    // beacon, presumption gap, end state — in that order.
    assert.deepEqual(
        completed.map((node) => node.kind),
        [LayeredNodeKind.beacon, LayeredNodeKind.presumedUserEdit, LayeredNodeKind.endState],
    );
});

test("test_loadLayeredProject_session_timeline_ends_with_end_state_and_gap", () => {
    // Scenario: a loaded session timeline whose file EXISTS on disk with different bytes ends
    // with a presumption gap and the end-state node.
    // Steps:
    // one session writes gamma.py; the on-disk gamma.py holds a later user change.
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
    // the timeline is exactly: write beacon, presumption gap, end state with the disk bytes.
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
