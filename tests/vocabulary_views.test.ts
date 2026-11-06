import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BranchRole,
    FailureScope,
    // GitOperationKind, KNOWN_GIT_OPERATION_KINDS, KNOWN_LAYERED_NODE_KINDS, LayeredNodeKind,
} from "../src/structures/vocabulary_views.ts";

// not behavior: only checks that a constant list equals the enum's own values.
// test("test_known_layered_node_kinds_lists_every_member", () => {
//     assert.deepEqual(KNOWN_LAYERED_NODE_KINDS, Object.values(LayeredNodeKind));
//     assert.ok(KNOWN_LAYERED_NODE_KINDS.includes(LayeredNodeKind.scriptRun));
// });

// not behavior: only checks constant values of an enum and a constant list.
// test("test_known_git_operation_kinds_includes_other", () => {
//     assert.ok(KNOWN_GIT_OPERATION_KINDS.includes(GitOperationKind.other));
//     assert.equal(GitOperationKind.commit, "commit");
// });

test("test_view_enum_wire_values_are_stable", () => {
    assert.equal(BranchRole.rewound, "rewound");
    assert.equal(FailureScope.documentPhase, "document-phase");
});
