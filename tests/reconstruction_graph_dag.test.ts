import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildDagFromBranches,
    findConversationRootUuid,
} from "../src/reconstruction_graph_dag.ts";
import { EventKind, RecordType } from "../src/structures/vocabulary.ts";
import { BranchRole } from "../src/structures/vocabulary_views.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { ConvoBranch, GraphTurn } from "../src/reconstruction_graph.ts";

function makeBranch(role: BranchRole, times: string[]): ConvoBranch {
    const turns: GraphTurn[] = [];
    for (const time of times) {
        turns.push({
            letter: "B",
            kind: EventKind.write,
            target: new Path("/work/a.py"),
            changeId: new Uuid(time),
            timestamp: new Date(time),
        });
    }
    return { role, tip: new Uuid("tip"), rewindPoint: undefined, turns };
}

test("test_build_dag_from_branches_makes_trunk_for_one_branch", () => {
    const only = makeBranch(BranchRole.surviving, ["2026-01-01T16:01:00Z"]);
    const dag = buildDagFromBranches(undefined, [only]);
    assert.equal(dag.rootLetter, "A");
    assert.equal(dag.trunk, only.turns);
    assert.equal(dag.branches.length, 0);
});

test("test_build_dag_from_branches_orders_oldest_first_and_file_less_last", () => {
    const empty = makeBranch(BranchRole.surviving, []);
    const late = makeBranch(BranchRole.rewound, ["2026-01-01T16:10:00Z"]);
    const early = makeBranch(BranchRole.rewound, ["2026-01-01T16:01:00Z"]);
    const dag = buildDagFromBranches(undefined, [empty, late, early]);
    assert.equal(dag.trunk.length, 0);
    assert.deepEqual(dag.branches, [early, late, empty]);
});

test("test_find_conversation_root_uuid_prefers_rewind_point_then_first_parentless_record", () => {
    const root = { type: RecordType.user, uuid: new Uuid("R"), parentUuid: null } as unknown as TranscriptRecord;
    const child = { type: RecordType.user, uuid: new Uuid("C"), parentUuid: new Uuid("R") } as unknown as TranscriptRecord;
    assert.equal(findConversationRootUuid([child, root], [])!.toString(), "R");
    const rewound = { ...makeBranch(BranchRole.rewound, []), rewindPoint: new Uuid("RP") };
    assert.equal(findConversationRootUuid([root], [rewound])!.toString(), "RP");
});
