import { test } from "node:test";
import assert from "node:assert/strict";
import {
    assignTurnLetters,
    buildConversationDag,
    buildFileDag,
} from "../src/reconstruction_graph.ts";
import { BlockType, BranchRole, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { loadRecords } from "./utilities.ts";
import { S13_JSONL } from "./fixtures.ts";

// A synthetic Write tool_use content block whose id becomes the turn's changeId.
function buildWriteBlock(toolId: string, filePath: string, content: string): Record<string, unknown> {
    return { type: BlockType.tool_use, id: toolId, name: ToolName.Write, input: { file_path: filePath, content } };
}

// A synthetic assistant record carrying one Write tool_use (the file-changing turn the graph models).
// `toolId` becomes the turn's changeId; uuid/parent place it in the conversation tree.
function buildWriteRecord(
    toolId: string,
    uuid: string,
    parent: string | null,
    filePath: string,
    content: string,
    timestamp: string,
): TranscriptRecord {
    return {
        type: RecordType.assistant,
        uuid: new Uuid(uuid),
        parentUuid: parent === null ? null : new Uuid(parent),
        timestamp: new Date(timestamp),
        cwd: new Path("/work"),
        message: { content: [buildWriteBlock(toolId, filePath, content)] },
    } as unknown as TranscriptRecord;
}

// A bare user prompt record (no file change) — used for the conversation root.
function buildUserRecord(uuid: string, parent: string | null, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.user,
        uuid: new Uuid(uuid),
        parentUuid: parent === null ? null : new Uuid(parent),
        timestamp: new Date(timestamp),
    } as unknown as TranscriptRecord;
}

function buildLastPrompt(leaf: string): TranscriptRecord {
    return { type: RecordType.lastPrompt, leafUuid: leaf } as unknown as TranscriptRecord;
}

// A single linear chain: root prompt then two writes, no rewind (no abandoned head).
function buildLinearRecords(): TranscriptRecord[] {
    return [
        buildUserRecord("R", null, "2026-01-01T16:00:00Z"),
        buildWriteRecord("u1", "Wa", "R", "/work/a.py", "a\n", "2026-01-01T16:01:00Z"),
        buildWriteRecord("u2", "Wb", "Wa", "/work/b.py", "b\n", "2026-01-01T16:02:00Z"),
        buildLastPrompt("Wb"),
    ];
}

// A rewind fork (mirrors S12 shape with writes on both branches): a rewound branch that writes two
// files at 16:09, then a conversation-only rewind to root and a surviving branch that writes two files
// at 16:10. No snapshots → the surviving head is the final last-prompt (Et).
function buildForkedRecords(): TranscriptRecord[] {
    return [
        buildUserRecord("R", null, "2026-01-01T16:00:00Z"),
        buildWriteRecord("toolu_B", "Bt", "R", "/work/scenario.py", "add\n", "2026-01-01T16:09:32Z"),
        buildWriteRecord("toolu_C", "Ct", "Bt", "/work/test.py", "tadd\n", "2026-01-01T16:09:33Z"),
        buildLastPrompt("Ct"),
        buildWriteRecord("toolu_D", "Dt", "R", "/work/scenario.py", "mul\n", "2026-01-01T16:10:31Z"),
        buildWriteRecord("toolu_E", "Et", "Dt", "/work/test.py", "tmul\n", "2026-01-01T16:10:32Z"),
        { type: RecordType.mode } as TranscriptRecord,
        buildLastPrompt("Et"),
    ];
}

// assignTurnLetters letters every file-changing turn by timestamp order, starting at "B" ("A" is
// reserved for the conversation root), regardless of the records' supplied order.
test("test_assign_turn_letters_numbers_file_turns_from_B_in_timestamp_order", () => {
    // Three writes supplied OUT of timestamp order.
    const records = [
        buildWriteRecord("u3", "Wc", "Wb", "/work/c.py", "c\n", "2026-01-01T16:03:00Z"),
        buildWriteRecord("u1", "Wa", "R", "/work/a.py", "a\n", "2026-01-01T16:01:00Z"),
        buildWriteRecord("u2", "Wb", "Wa", "/work/b.py", "b\n", "2026-01-01T16:02:00Z"),
    ];
    const letters = assignTurnLetters(records);
    // Lettered by timestamp, not supplied order: 16:01 -> B, 16:02 -> C, 16:03 -> D.
    assert.equal(letters.get("u1"), "B");
    assert.equal(letters.get("u2"), "C");
    assert.equal(letters.get("u3"), "D");
});

// buildFileDag groups every turn under the file it touched, ordered files by first touch and turns by
// version; the letters are the SAME as assignTurnLetters (one letter per turn, shared by both graphs).
test("test_build_file_dag_groups_by_target_with_shared_letters", () => {
    const records = [
        buildWriteRecord("u1", "Wa", "R", "/work/a.py", "a\n", "2026-01-01T16:01:00Z"),
        buildWriteRecord("u2", "Wb", "Wa", "/work/b.py", "b\n", "2026-01-01T16:02:00Z"),
        buildWriteRecord("u3", "Wc", "Wb", "/work/a.py", "aa\n", "2026-01-01T16:03:00Z"),
    ];
    const letters = assignTurnLetters(records);
    const dag = buildFileDag(records);
    // Two files, ordered by first touch (a.py @16:01 before b.py @16:02).
    assert.equal(dag.files.length, 2);
    assert.equal(dag.files[0]!.target.toString(), "/work/a.py");
    assert.equal(dag.files[1]!.target.toString(), "/work/b.py");
    // a.py has two turns in version order (B then D); b.py has one (C).
    assert.deepEqual(dag.files[0]!.turns.map((turn) => turn.letter), ["B", "D"]);
    assert.deepEqual(dag.files[1]!.turns.map((turn) => turn.letter), ["C"]);
    // The fileDAG letters cross-link to assignTurnLetters (shared-letter invariant).
    assert.equal(dag.files[0]!.turns[0]!.letter, letters.get("u1"));
    assert.equal(dag.files[0]!.turns[1]!.letter, letters.get("u3"));
});

// With no rewind, buildConversationDag is LINEAR: no branch wrappers, every file turn in the trunk.
test("test_build_conversation_dag_is_linear_when_no_fork", () => {
    const dag = buildConversationDag(buildLinearRecords());
    assert.equal(dag.rootLetter, "A");
    assert.equal(dag.rootUuid!.toString(), "R");
    assert.equal(dag.branches.length, 0);
    assert.deepEqual(dag.trunk.map((turn) => turn.letter), ["B", "C"]);
});

// With a rewind that changed files on both sides, buildConversationDag FORKS into two branch wrappers
// ordered oldest-first (the rewound branch's turns are older), each carrying only its post-fork turns.
test("test_build_conversation_dag_forks_into_rewound_and_surviving", () => {
    const dag = buildConversationDag(buildForkedRecords());
    // The root is the conversation root R.
    assert.equal(dag.rootUuid!.toString(), "R");
    // Forked: two wrappers, no trunk turns.
    assert.equal(dag.trunk.length, 0);
    assert.equal(dag.branches.length, 2);
    // Oldest-first: rewound (writes @16:09) before surviving (writes @16:10).
    assert.equal(dag.branches[0]!.role, BranchRole.rewound);
    assert.equal(dag.branches[1]!.role, BranchRole.surviving);
    // The rewound branch carries its two writes (B, C); the surviving its two (D, E).
    assert.deepEqual(dag.branches[0]!.turns.map((turn) => turn.letter), ["B", "C"]);
    assert.deepEqual(dag.branches[1]!.turns.map((turn) => turn.letter), ["D", "E"]);
});

// S13's surviving branch only Read (zero post-fork file turns) while the abandoned branch edited a
// file. The fork must still render: the file-less surviving branch is KEPT as a branch (so the DAG
// shows two branches and roots at the rewind point 8faab841), not collapsed into a misleading trunk.
test("test_a_file_less_surviving_branch_is_kept_when_a_rewound_branch_exists", () => {
    // Build the conversationDAG for the real S13 transcript.
    const dag = buildConversationDag(loadRecords(S13_JSONL));
    // It forks: two branches, no trunk turns, rooted at the rewind point 8faab841.
    assert.equal(dag.trunk.length, 0);
    assert.equal(dag.branches.length, 2);
    assert.equal(dag.rootUuid!.toString().slice(0, 8), "b55cd7c5");
    // One branch is the rewound edit branch (one `edit` turn); the other a file-less surviving branch.
    const rewound = dag.branches.find((branch) => branch.role === BranchRole.rewound)!;
    const surviving = dag.branches.find((branch) => branch.role === BranchRole.surviving)!;
    assert.equal(rewound.turns.length, 1);
    assert.equal(surviving.turns.length, 0);
});

// The file-less surviving branch sorts BELOW the rewound branch that has a real turn — matching S11's
// oldest-first / rewound-above-surviving ordering (an empty branch has no time, so it renders last).
test("test_an_empty_surviving_branch_sorts_below_a_rewound_branch_with_turns", () => {
    // Build the conversationDAG for the real S13 transcript.
    const dag = buildConversationDag(loadRecords(S13_JSONL));
    // The branch order is [rewound, surviving].
    assert.equal(dag.branches[0]!.role, BranchRole.rewound);
    assert.equal(dag.branches[1]!.role, BranchRole.surviving);
});

