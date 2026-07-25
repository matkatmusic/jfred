// Task 202 (spec S5): the per-entity merged multi-session view — nodes from every session
// ordered on the one instant axis, one end state (not one per session), presumption gaps
// re-derived at merged level, and corroboration marks where two DISTINCT sessions observed the
// same bytes (the input for spec S8's dashed cross-lane lines).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary.ts";
import { mergeSessionTimelines } from "../src/layered_merge.ts";
import type {
    BeaconNode,
    EndStateNode,
    PreAnchorStubNode,
    PresumedUserEditNode,
    ReconstructionEntity,
    SessionTimeline,
    TimelineNode,
} from "../src/layered_types.ts";

const SESSION_A_FILE = new Path("/fixture/a.jsonl");
const SESSION_B_FILE = new Path("/fixture/b.jsonl");
const ENTITY_FILE = new Path("/w/alpha.py");

// A beacon literal at an epoch-ms instant (the fixtures need only relative order).
function makeBeacon(instantMs: number, content: string): BeaconNode {
    return {
        kind: LayeredNodeKind.beacon,
        instant: new Date(instantMs),
        content,
        evidence: { sessionFile: SESSION_A_FILE, line: 1 },
    };
}

// A byteless pre-anchor stub literal.
function makeStub(instantMs: number): PreAnchorStubNode {
    return {
        kind: LayeredNodeKind.preAnchorStub,
        instant: new Date(instantMs),
        evidence: { sessionFile: SESSION_A_FILE, line: 2 },
    };
}

// The on-disk end state literal task 199 appends to EVERY session's timeline.
function makeEndState(instantMs: number, content: string): EndStateNode {
    return { kind: LayeredNodeKind.endState, instant: new Date(instantMs), content };
}

// A per-session presumption gap literal (task 199 inserts these before the merge runs).
function makeGap(instantMs: number): PresumedUserEditNode {
    return { kind: LayeredNodeKind.presumedUserEdit, instant: new Date(instantMs) };
}

function makeSessionTimeline(sessionFile: Path, nodes: TimelineNode[]): SessionTimeline {
    return { sessionFile, timeline: { nodes } };
}

function makeEntity(sessionTimelines: SessionTimeline[]): ReconstructionEntity {
    return { filename: ENTITY_FILE, sessionTimelines };
}

// The content of every node that carries bytes, in merged order, as one comparable string.
function listContents(nodes: { node: TimelineNode }[]): string {
    return nodes
        .map((merged) => (merged.node as { content?: string }).content)
        .filter((content) => content !== undefined)
        .join(",");
}

test("test_merge_interleaves_two_sessions_by_instant", () => {
    // Scenario: session A's nodes bracket session B's; the merged order is by instant, and each
    // node keeps the session that observed it.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [makeBeacon(1000, "a1"), makeBeacon(3000, "a3")]),
        makeSessionTimeline(SESSION_B_FILE, [makeBeacon(2000, "b2")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    assert.equal(listContents(merged.nodes), "a1,b2,a3");
    const owners = merged.nodes
        .filter((node) => node.node.kind === LayeredNodeKind.beacon)
        .map((node) => node.sessionFile?.toString());
    assert.deepEqual(owners, [
        SESSION_A_FILE.toString(),
        SESSION_B_FILE.toString(),
        SESSION_A_FILE.toString(),
    ]);
});

test("test_merge_marks_same_bytes_across_sessions_as_corroborating", () => {
    // Scenario: two sessions observed the same bytes at different instants — each node names the
    // other session as corroboration, never itself.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [makeBeacon(1000, "same")]),
        makeSessionTimeline(SESSION_B_FILE, [makeBeacon(2000, "same")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    assert.deepEqual(
        merged.nodes.map((node) => node.corroboratedBy.map((path) => path.toString())),
        [[SESSION_B_FILE.toString()], [SESSION_A_FILE.toString()]],
    );
});

test("test_merge_leaves_single_session_uncorroborated", () => {
    // Scenario: the degenerate case — one session, two nodes with identical bytes. Corroboration
    // needs two DISTINCT sessions, so nothing is marked.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [makeBeacon(1000, "dup"), makeBeacon(2000, "dup")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    assert.equal(merged.nodes.length, 2);
    for (const node of merged.nodes) {
        assert.deepEqual(node.corroboratedBy, []);
    }
});

test("test_merge_keeps_one_end_state_node", () => {
    // Scenario: task 199 appended the same on-disk end state to BOTH session timelines. The
    // merged view holds exactly one, last, owned by no session.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [makeBeacon(1000, "a1"), makeEndState(9000, "final")]),
        makeSessionTimeline(SESSION_B_FILE, [makeBeacon(2000, "b2"), makeEndState(9000, "final")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    const endStates = merged.nodes.filter((node) => node.node.kind === LayeredNodeKind.endState);
    assert.equal(endStates.length, 1);
    assert.equal(merged.nodes[merged.nodes.length - 1]!.node.kind, LayeredNodeKind.endState);
    assert.equal(endStates[0]!.sessionFile, undefined);
});

test("test_merge_rederives_presumption_gaps_across_sessions", () => {
    // Scenario: session A could not explain x -> z and left a gap; session B's beacon sits
    // between them. The merged view drops A's stale gap and re-derives one gap per differing
    // adjacent pair (x -> y, y -> z), owned by no session.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [
            makeBeacon(1000, "x"),
            makeGap(3000),
            makeBeacon(3000, "z"),
        ]),
        makeSessionTimeline(SESSION_B_FILE, [makeBeacon(2000, "y")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    const gaps = merged.nodes.filter((node) => node.node.kind === LayeredNodeKind.presumedUserEdit);
    assert.equal(gaps.length, 2);
    assert.deepEqual(gaps.map((gap) => gap.node.instant.getTime()), [2000, 3000]);
    for (const gap of gaps) {
        assert.equal(gap.sessionFile, undefined);
    }
});

test("test_merge_keeps_byteless_stubs_uncorroborated", () => {
    // Scenario: a pre-anchor stub carries no bytes, so it survives the merge with its session
    // attribution and can never corroborate or be corroborated.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [makeStub(500), makeBeacon(1000, "same")]),
        makeSessionTimeline(SESSION_B_FILE, [makeBeacon(2000, "same")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    const stub = merged.nodes.find((node) => node.node.kind === LayeredNodeKind.preAnchorStub);
    assert.equal(stub?.sessionFile?.toString(), SESSION_A_FILE.toString());
    assert.deepEqual(stub?.corroboratedBy, []);
});

test("test_merge_corroborates_end_state_with_every_session_that_saw_its_bytes", () => {
    // Scenario: both sessions observed the bytes the file still holds on disk — the end state
    // (owned by no session) is corroborated by both.
    const entity = makeEntity([
        makeSessionTimeline(SESSION_A_FILE, [makeBeacon(1000, "final"), makeEndState(9000, "final")]),
        makeSessionTimeline(SESSION_B_FILE, [makeBeacon(2000, "final"), makeEndState(9000, "final")]),
    ]);

    const merged = mergeSessionTimelines(entity);

    const endState = merged.nodes[merged.nodes.length - 1]!;
    assert.deepEqual(
        endState.corroboratedBy.map((path) => path.toString()).sort(),
        [SESSION_A_FILE.toString(), SESSION_B_FILE.toString()],
    );
});
