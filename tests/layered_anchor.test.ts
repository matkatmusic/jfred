// Task 198 (spec S2): the anchor is a timeline's first full-content beacon; earlier byteless mentions must refuse byte-consuming operations.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary_views.ts";
import { getRequiredNodeContent, selectAnchorNode } from "../src/layered_anchor.ts";
import type {
    BeaconNode,
    EndStateNode,
    PreAnchorStubNode,
    PresumedUserEditNode,
    Timeline,
    TimelineNode,
} from "../src/layered_types.ts";

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

test("test_getRequiredNodeContent_returns_beacon_content", () => {
    const beacon = buildBeaconNode(new Date("2026-07-24T10:01:00.000Z"), "verified bytes\n");
    assert.equal(getRequiredNodeContent(beacon), "verified bytes\n");
});

test("test_getRequiredNodeContent_returns_end_state_content", () => {
    const endState: EndStateNode = {
        kind: LayeredNodeKind.endState,
        instant: new Date("2026-07-24T10:09:00.000Z"),
        content: "final bytes\n",
    };
    assert.equal(getRequiredNodeContent(endState), "final bytes\n");
});

test("test_getRequiredNodeContent_refuses_pre_anchor_stub", () => {
    // Scenario: a pre-anchor stub is display/placement only — asking for bytes throws.
    const stub = buildStubNode(new Date("2026-07-24T10:01:00.000Z"));
    assert.throws(() => getRequiredNodeContent(stub), /pre-anchor-stub.*byte/);
});

test("test_getRequiredNodeContent_refuses_presumed_user_edit_node", () => {
    // Scenario: a presumption-gap node is byteless too — asking for bytes throws.
    const gap: PresumedUserEditNode = {
        kind: LayeredNodeKind.presumedUserEdit,
        instant: new Date("2026-07-24T10:05:00.000Z"),
    };
    assert.throws(() => getRequiredNodeContent(gap), /presumed-user-edit.*byte/);
});
