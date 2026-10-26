// Task 198 (spec S2): evidence classes decide which transcript mentions become beacons and which stay pre-anchor stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary_views.ts";
import { loadLayeredProject } from "../src/layered_load.ts";
import { collectReadEchoNodes, getRequiredNodeContent, selectAnchorNode } from "../src/layered_anchor.ts";
import type { ReconstructionEntity, Timeline } from "../src/layered_types.ts";
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
    assert.equal(getRequiredNodeContent(node), "line one\nline two\n");
});

test("test_edit_with_populated_originalFile_becomes_a_beacon", () => {
    // An Edit result's populated originalFile is the literal pre-edit file — full content.
    const timeline = loadAlphaTimeline(makeEvidenceClassFixture());
    const node = timeline.nodes[4]!;
    assert.equal(node.kind, LayeredNodeKind.beacon);
    assert.equal(getRequiredNodeContent(node), "line one\nline two\n");
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

test("test_read_echo_placement_carries_change_id_and_instant", () => {
    const tree = makeSourceTree("-placement-project");
    const readPair = buildReadRecordPair(
        { sessionId: SESSION_A, cwd: "/work", timestamp: "2026-07-24T10:04:00.000Z", toolId: "toolu_read_1", parentUuid: null },
        "/work/a.py",
        "one\n",
        { startLine: 1, numLines: 1, totalLines: 1 },
    );
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", readPair.records);
    const [placement] = collectReadEchoNodes(records, STUB_EVIDENCE.sessionFile);
    assert.equal(placement!.changeId.toString(), "toolu_read_1");
    assert.equal(placement!.instant.toISOString(), "2026-07-24T10:04:00.000Z");
});
