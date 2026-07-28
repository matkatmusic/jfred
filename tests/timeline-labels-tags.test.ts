// step tags, diff fallback text, tool-activity tags, summaries (timeline-labels.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeRevisionDiffFallbackText,
    computeToolActivityTag,
    computeUnattributedStepTag,
    truncateToolCallSummary,
} from "../webapp/views/timeline-labels.ts";
import {
    AGENT_TURN_NODE_KIND,
    USER_TURN_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import {
    EventKind,
    GitOperationKind,
} from "../src/structures/vocabulary.ts";

test("test_computeUnattributedStepTag_names_a_single_event_kind", () => {
    // Item 10d: one chip kind yields a humanized tag; script-execution has dedicated wording.
    assert.equal(computeUnattributedStepTag(["user-edit"]), "user edit");
    assert.equal(computeUnattributedStepTag(["script-execution"]), "script run");
});

test("test_computeUnattributedStepTag_joins_distinct_kinds", () => {
    // Repeated kinds dedupe; distinct kinds join in first-appearance order.
    assert.equal(computeUnattributedStepTag(["user-edit", "user-edit", "write"]), "user edit · write");
});

test("test_computeUnattributedStepTag_returns_undefined_for_no_kinds", () => {
    // A chipless step must yield undefined, never an empty span.
    assert.equal(computeUnattributedStepTag([]), undefined);
});

test("test_computeRevisionDiffFallbackText_explains_a_missing_block", () => {
    // Item 47: the +/- drawer got no block for this revision.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.rename, renamedFrom: undefined, isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(computeRevisionDiffFallbackText(undefined, change), "(no diff block for this revision)");
});

test("test_computeRevisionDiffFallbackText_explains_a_rename_block", () => {
    // Item 47: renderDiffWithContext emits no body for renames, so the header-only block
    // otherwise rendered as an empty-looking +/- pane.
    const change = { path: "/tmp/core_inventory.py", displayPath: "/tmp/core_inventory.py", eventKind: EventKind.rename, renamedFrom: "/tmp/inventory.py", isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    const block = "@@ renamed /tmp/inventory.py → /tmp/core_inventory.py @ 2026-07-01T20:51:55.964Z @@";
    assert.equal(
        computeRevisionDiffFallbackText(block, change),
        "renamed /tmp/inventory.py → /tmp/core_inventory.py (content unchanged)",
    );
});

test("test_computeRevisionDiffFallbackText_passes_real_diff_blocks_through", () => {
    // A block with hunk lines renders as a diff, not as fallback text.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    const block = "@@ changed @ 2026-07-01T20:50:14.283Z @@\n@@ -1,2 +1,2 @@\n-old\n+new";
    assert.equal(computeRevisionDiffFallbackText(block, change), undefined);
});

test("test_computeToolActivityTag_tags_chip_carrying_blank_turns_as_tool_result", () => {
    // Item 52: a textless agent turn carrying chips is tool activity — the chips are results.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: "", fileChanges: [change], gitOperations: [] }),
        "tool result",
    );
});

// (item 55) the "tool call" branch is retired — git rows moved out of agent-turn bubbles into
// standalone tool-call nodes, so a blank turn with only gitOperations no longer exists.
// test("test_computeToolActivityTag_tags_gitop_only_blank_turns_as_tool_call", () => {
//     const operation = { kind: GitOperationKind.commit, when: "2026-01-01T00:00:00.000Z" };
//     assert.equal(
//         computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: " ", fileChanges: [], gitOperations: [operation] }),
//         "tool call",
//     );
// });

test("test_computeToolActivityTag_ignores_gitop_only_blank_turns", () => {
    // Item 55: git rows are standalone tool-call nodes now, so the old "tool call" tag is retired.
    const operation = { kind: GitOperationKind.commit, when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: " ", fileChanges: [], gitOperations: [operation] }),
        undefined,
    );
});

test("test_computeToolActivityTag_ignores_replies_and_user_turns", () => {
    // Real replies (non-blank text) and user turns are never tool activity.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: "Done.", fileChanges: [change], gitOperations: [] }),
        undefined,
    );
    assert.equal(
        computeToolActivityTag({ kind: USER_TURN_NODE_KIND, text: "", fileChanges: [], gitOperations: [] }),
        undefined,
    );
});

test("test_truncate_tool_call_summary_caps_at_50_chars", () => {
    // Tool rows must stay single-line so the [{ }] <TS> L:n parts remain visible.
    const longSummary = "x".repeat(120);
    assert.equal(truncateToolCallSummary(longSummary), `${"x".repeat(50)}…`);
    assert.equal(truncateToolCallSummary("git init"), "git init");
    assert.equal(truncateToolCallSummary("line one\nline two"), "line one");
});
