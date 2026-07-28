// Task 198 (spec S2): the anchor is a timeline's first full-content beacon; earlier byteless mentions must refuse byte-consuming operations.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary.ts";
import { loadLayeredProject } from "../src/layered_load.ts";
import { requireNodeContent, selectAnchorNode } from "../src/layered_anchor.ts";
import type {
    BeaconNode,
    EndStateNode,
    PreAnchorStubNode,
    PresumedUserEditNode,
    ReconstructionEntity,
    Timeline,
    TimelineNode,
} from "../src/layered_types.ts";
import {
    SESSION_A,
    buildEditRecordPair,
    buildPromptRecord,
    buildReadRecordPair,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

// Phase-A tests never dereference this pointer.
const STUB_EVIDENCE = { sessionFile: new Path("/tmp/a.jsonl"), line: 1 };

function buildStubNode(instant: Date): PreAnchorStubNode {
    return { kind: LayeredNodeKind.preAnchorStub, instant, evidence: STUB_EVIDENCE };
}

function buildBeaconNode(instant: Date, content: string): BeaconNode {
    return { kind: LayeredNodeKind.beacon, instant, content, evidence: STUB_EVIDENCE };
}

function buildTimeline(nodes: TimelineNode[]): Timeline {
    return { nodes };
}

test("test_selectAnchorNode_returns_first_beacon_of_timeline", () => {
    // The anchor is the FIRST beacon in instant order, not any later one.
    const anchorBeacon = buildBeaconNode(new Date("2026-07-24T10:03:00.000Z"), "anchor bytes\n");
    const laterBeacon = buildBeaconNode(new Date("2026-07-24T10:04:00.000Z"), "later bytes\n");
    const timeline = buildTimeline([
        buildStubNode(new Date("2026-07-24T10:01:00.000Z")),
        buildStubNode(new Date("2026-07-24T10:02:00.000Z")),
        anchorBeacon,
        laterBeacon,
    ]);
    assert.equal(selectAnchorNode(timeline), anchorBeacon);
});

test("test_selectAnchorNode_returns_undefined_when_timeline_has_no_beacon", () => {
    // A timeline of byteless mentions only has no anchor yet.
    const timeline = buildTimeline([
        buildStubNode(new Date("2026-07-24T10:01:00.000Z")),
        buildStubNode(new Date("2026-07-24T10:02:00.000Z")),
    ]);
    assert.equal(selectAnchorNode(timeline), undefined);
});

test("test_requireNodeContent_returns_beacon_content", () => {
    const beacon = buildBeaconNode(new Date("2026-07-24T10:01:00.000Z"), "verified bytes\n");
    assert.equal(requireNodeContent(beacon), "verified bytes\n");
});

test("test_requireNodeContent_returns_end_state_content", () => {
    const endState: EndStateNode = {
        kind: LayeredNodeKind.endState,
        instant: new Date("2026-07-24T10:09:00.000Z"),
        content: "final bytes\n",
    };
    assert.equal(requireNodeContent(endState), "final bytes\n");
});

test("test_requireNodeContent_refuses_pre_anchor_stub", () => {
    // Scenario: a pre-anchor stub is display/placement only — asking for bytes throws.
    const stub = buildStubNode(new Date("2026-07-24T10:01:00.000Z"));
    assert.throws(() => requireNodeContent(stub), /pre-anchor-stub.*byte/);
});

test("test_requireNodeContent_refuses_presumed_user_edit_node", () => {
    // Scenario: a presumption-gap node is byteless too — asking for bytes throws.
    const gap: PresumedUserEditNode = {
        kind: LayeredNodeKind.presumedUserEdit,
        instant: new Date("2026-07-24T10:05:00.000Z"),
    };
    assert.throws(() => requireNodeContent(gap), /presumed-user-edit.*byte/);
});


type EvidenceClassFixture = { projectDir: string; alphaPath: string };

// One session touches alpha.py five ways: partial read and originalFile-less edit are stubs; the rest are beacons.
function makeEvidenceClassFixture(): EvidenceClassFixture {
    const tree = makeSourceTree("-anchor-project");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const alphaPath = join(workspaceRoot, "alpha.py");
    const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" line one", "-line two", "+line 2"] };
    const partialRead = buildReadRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_anchor_r1", parentUuid: "prompt-1" },
        alphaPath,
        "line one\n",
        { startLine: 1, numLines: 1, totalLines: 3 },
    );
    const editWithoutOriginal = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_anchor_e1", parentUuid: partialRead.lastUuid },
        alphaPath,
        "line one\nline two\n",
        null,
        hunk,
    );
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:03:00.000Z", toolId: "toolu_anchor_w1", parentUuid: editWithoutOriginal.lastUuid },
        alphaPath,
        "line one\nline two\n",
    );
    const completeRead = buildReadRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:04:00.000Z", toolId: "toolu_anchor_r2", parentUuid: writeAlpha.lastUuid },
        alphaPath,
        "line one\nline two\n",
        { startLine: 1, numLines: 2, totalLines: 2 },
    );
    const editWithOriginal = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:05:00.000Z", toolId: "toolu_anchor_e2", parentUuid: completeRead.lastUuid },
        alphaPath,
        "line one\nline 2\n",
        "line one\nline two\n",
        hunk,
    );
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [
        buildPromptRecord("prompt-1", null, "2026-07-24T10:00:00.000Z", workspaceRoot),
        ...partialRead.records,
        ...editWithoutOriginal.records,
        ...writeAlpha.records,
        ...completeRead.records,
        ...editWithOriginal.records,
    ]);
    return { projectDir: tree.projectDir, alphaPath };
}

function loadAlphaTimeline(fixture: EvidenceClassFixture): Timeline {
    const graph = loadLayeredProject(new Path(fixture.projectDir), {});
    const alpha = graph.entities.find(
        (candidate: ReconstructionEntity) => candidate.filename.toString() === fixture.alphaPath,
    );
    assert.ok(alpha, `no entity for ${fixture.alphaPath}`);
    assert.equal(alpha.sessionTimelines.length, 1);
    return alpha.sessionTimelines[0]!.timeline;
}

test("test_partial_read_echo_stays_a_pre_anchor_stub", () => {
    // A Read that echoes only a window of the file is a byteless mention.
    const timeline = loadAlphaTimeline(makeEvidenceClassFixture());
    assert.equal(timeline.nodes[0]!.kind, LayeredNodeKind.preAnchorStub);
});

test("test_edit_without_originalFile_stays_a_pre_anchor_stub", () => {
    // An Edit whose result reports no originalFile carries no full content.
    const timeline = loadAlphaTimeline(makeEvidenceClassFixture());
    assert.equal(timeline.nodes[1]!.kind, LayeredNodeKind.preAnchorStub);
});

test("test_complete_read_echo_becomes_a_beacon", () => {
    // A Read echoing the WHOLE file (line 1 through totalLines) is verified full content.
    const timeline = loadAlphaTimeline(makeEvidenceClassFixture());
    const node = timeline.nodes[3]!;
    assert.equal(node.kind, LayeredNodeKind.beacon);
    assert.equal(requireNodeContent(node), "line one\nline two\n");
});

test("test_edit_with_populated_originalFile_becomes_a_beacon", () => {
    // An Edit result's populated originalFile is the literal pre-edit file — full content.
    const timeline = loadAlphaTimeline(makeEvidenceClassFixture());
    const node = timeline.nodes[4]!;
    assert.equal(node.kind, LayeredNodeKind.beacon);
    assert.equal(requireNodeContent(node), "line one\nline two\n");
});

test("test_anchor_skips_pre_anchor_stubs_before_first_full_content_evidence", () => {
    // With two byteless mentions before the Write, the anchor is the Write beacon.
    const timeline = loadAlphaTimeline(makeEvidenceClassFixture());
    assert.equal(timeline.nodes.length, 5);
    const anchor = selectAnchorNode(timeline);
    assert.ok(anchor);
    assert.equal(anchor?.instant.toISOString(), "2026-07-24T10:03:00.000Z");
    assert.equal(anchor?.content, "line one\nline two\n");
});
