import { test } from "node:test";
import assert from "node:assert/strict";
import {
    renderConversationDag,
    renderFileDag,
    renderGraphs,
} from "../src/reconstruction_graph_render.ts";
import type {
    ConversationDag,
    FileDag,
    GraphTurn,
} from "../src/reconstruction_graph.ts";
import type { ConvoBranch } from "../src/reconstruction_graph.ts";
import { BranchRole, EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// A graph node with the given letter/kind/file/changeId (timestamp is only used for branch ordering, which the builders already decided, so a fixed value is fine for renderer tests).
function makeTurn(letter: string, kind: EventKind, file: string, changeId: string): GraphTurn {
    return {
        letter,
        kind,
        target: new Path(`/work/dir/${file}`),
        changeId: new Uuid(changeId),
        timestamp: new Date("2026-01-01T16:10:00Z"),
    };
}

// A conversationDAG branch wrapper with its role, tip, rewind point, and turns.
function makeBranch(role: BranchRole, tip: Uuid, rewindPoint: Uuid | undefined, turns: GraphTurn[]): ConvoBranch {
    return { role, tip, rewindPoint, turns };
}

const ROOT = new Uuid("94000895-217c-4fc7-93f1-d24afe2f46f6");
const REWOUND_TIP = new Uuid("cba30c9f-daca-460d-afbe-e02844093467");
const SURVIVING_TIP = new Uuid("d2ed6f49-160b-4b5c-a364-ba2a0ef9c205");

// The S12 forked conversationDAG: a root, a rewound branch (writes), a surviving branch (edits).
function buildForkedConvoDag(): ConversationDag {
    const rewound = makeBranch(BranchRole.rewound, REWOUND_TIP, ROOT, [
        makeTurn("B", EventKind.write, "scenario12.py", "toolu_015zSRxJ93FV3tpqoy4kZ3AR"),
        makeTurn("C", EventKind.write, "test_scenario12.py", "toolu_018wtDuedtHLmqtYGy71vVdC"),
    ]);
    const surviving = makeBranch(BranchRole.surviving, SURVIVING_TIP, undefined, [
        makeTurn("D", EventKind.edit, "scenario12.py", "toolu_01NjGUyNRPyhZYw4Ws1HtjYE"),
        makeTurn("E", EventKind.edit, "test_scenario12.py", "toolu_0161dgZLqA2Z6m5bkhabofUx"),
    ]);
    return { rootLetter: "A", rootUuid: ROOT, trunk: [], branches: [rewound, surviving] };
}

// A no-fork linear conversationDAG: a root and two trunk turns, no branches.
function buildLinearConvoDag(): ConversationDag {
    return {
        rootLetter: "A",
        rootUuid: ROOT,
        trunk: [
            makeTurn("B", EventKind.write, "a.py", "toolu_aaaaaaaa1111"),
            makeTurn("C", EventKind.edit, "a.py", "toolu_bbbbbbbb2222"),
        ],
        branches: [],
    };
}

// One fileDAG entry: a file's path and its version-ordered turns.
function makeFileEntry(file: string, turns: GraphTurn[]): FileDag["files"][number] {
    return { target: new Path(`/work/dir/${file}`), turns };
}

// The S12 fileDAG: two files, each with a write then an edit.
function buildFileDag(): FileDag {
    const scenario = makeFileEntry("scenario12.py", [
        makeTurn("B", EventKind.write, "scenario12.py", "toolu_015zSRxJ93FV3tpqoy4kZ3AR"),
        makeTurn("D", EventKind.edit, "scenario12.py", "toolu_01NjGUyNRPyhZYw4Ws1HtjYE"),
    ]);
    const tests = makeFileEntry("test_scenario12.py", [
        makeTurn("C", EventKind.write, "test_scenario12.py", "toolu_018wtDuedtHLmqtYGy71vVdC"),
        makeTurn("E", EventKind.edit, "test_scenario12.py", "toolu_0161dgZLqA2Z6m5bkhabofUx"),
    ]);
    return { files: [scenario, tests] };
}

// A forked conversationDAG renders oldest-first branch wrappers with connectors, the rewind-point note on the root, the role-named branch headers, and topology-only turn lines.
test("test_render_conversation_dag_forked_shows_branches_oldest_first", () => {
    const out = renderConversationDag(buildForkedConvoDag());
    // The header and the root with its rewind-point annotation.
    assert.ok(out.includes("══ conversationDAG ══"));
    assert.ok(out.includes("A  prompt  #94000895"));
    assert.ok(out.includes("(rewind point)"));
    // Both branch headers name the role, tip, and (rewound only) the rewind point.
    assert.ok(out.includes("branch rewound (rewound; tip #cba30c9f; rewind @ #94000895)"));
    assert.ok(out.includes("branch surviving (surviving; tip #d2ed6f49)"));
    // The rewound branch (older) renders before the surviving branch.
    assert.ok(out.indexOf("rewound") < out.indexOf("surviving"));
    // Turn lines are topology only: letter, kind, file base name, short change id.
    assert.ok(out.includes("B  write  scenario12.py"));
    assert.ok(out.includes("#015zSRxJ"));
    assert.ok(out.includes("D  edit"));
    // The last branch uses the corner connector.
    assert.ok(out.includes("└─ branch surviving"));
    assert.ok(out.includes("├─ branch rewound"));
});

// A no-fork conversationDAG renders a linear trunk: no branch wrappers, no rewind-point note.
test("test_render_conversation_dag_linear_has_no_branch_wrappers", () => {
    const out = renderConversationDag(buildLinearConvoDag());
    assert.ok(out.includes("══ conversationDAG ══"));
    assert.ok(out.includes("A  prompt  #94000895"));
    // No fork: no rewind-point note, no branch wrappers/connectors.
    assert.ok(!out.includes("(rewind point)"));
    assert.ok(!out.includes("branch "));
    assert.ok(!out.includes("├─"));
    assert.ok(!out.includes("└─"));
    // The trunk turns still render.
    assert.ok(out.includes("B  write  a.py"));
    assert.ok(out.includes("C  edit"));
});

// The fileDAG renders vertically: one base-name header per file then its version-ordered turns; the letters cross-link to the conversationDAG (B/C/D/E are the same turns).
test("test_render_file_dag_is_vertical_per_file_with_shared_letters", () => {
    const out = renderFileDag(buildFileDag());
    assert.ok(out.includes("══ fileDAG ══"));
    // scenario12.py block (B write, D edit) comes before test_scenario12.py block (C write, E edit).
    const scenarioAt = out.indexOf("scenario12.py\n");
    const testAt = out.indexOf("test_scenario12.py\n");
    assert.ok(scenarioAt >= 0 && testAt > scenarioAt);
    assert.ok(out.includes("B  write  #015zSRxJ"));
    assert.ok(out.includes("D  edit   #01NjGUyN"));
    assert.ok(out.includes("C  write  #018wtDue"));
    assert.ok(out.includes("E  edit   #0161dgZL"));
});

// renderGraphs prints the conversationDAG first, then the fileDAG, separated by a blank line.
test("test_render_graphs_prints_convo_before_file", () => {
    const records: never[] = [];
    const out = renderGraphs(records, { convo: true, file: true });
    const convoAt = out.indexOf("══ conversationDAG ══");
    const fileAt = out.indexOf("══ fileDAG ══");
    // Both present, convo first.
    assert.ok(convoAt >= 0);
    assert.ok(fileAt > convoAt);
});

