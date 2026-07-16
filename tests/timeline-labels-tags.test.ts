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
    // Scenario: an unattributed-lane step with one kind of chip gets a tag naming that kind,
    // humanized (item 10d).
    // Steps:
    // assert "user-edit" humanizes to "user edit" (hyphen becomes a space).
    assert.equal(computeUnattributedStepTag(["user-edit"]), "user edit");
    // assert "script-execution" gets its dedicated "script run" wording.
    assert.equal(computeUnattributedStepTag(["script-execution"]), "script run");
});

test("test_computeUnattributedStepTag_joins_distinct_kinds", () => {
    // Scenario: repeated kinds dedupe and distinct kinds join in first-appearance order.
    // Steps:
    // feed two user-edit chips and one write chip.
    // assert the tag names each kind once, joined with a middle dot.
    assert.equal(computeUnattributedStepTag(["user-edit", "user-edit", "write"]), "user edit · write");
});

test("test_computeUnattributedStepTag_returns_undefined_for_no_kinds", () => {
    // Scenario: a step with no chips gets no tag at all (undefined, never an empty span).
    // Steps:
    // assert an empty kind list yields undefined.
    assert.equal(computeUnattributedStepTag([]), undefined);
});

test("test_computeRevisionDiffFallbackText_explains_a_missing_block", () => {
    // Scenario: the +/- drawer got no block for this revision (item 47).
    // Steps:
    // assert an undefined block yields the "no diff block" message.
    const change = { path: "/tmp/a.py", eventKind: EventKind.rename, renamedFrom: undefined, isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(computeRevisionDiffFallbackText(undefined, change), "(no diff block for this revision)");
});

test("test_computeRevisionDiffFallbackText_explains_a_rename_block", () => {
    // Scenario: a rename revision's block is its kind header alone (renderDiffWithContext emits
    // no body for renames), which rendered as an empty-looking +/- pane (item 47, s84 Step 17).
    // Steps:
    // assert a single-line block on a renamedFrom-carrying change yields the rename explanation.
    const change = { path: "/tmp/core_inventory.py", eventKind: EventKind.rename, renamedFrom: "/tmp/inventory.py", isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    const block = "@@ renamed /tmp/inventory.py → /tmp/core_inventory.py @ 2026-07-01T20:51:55.964Z @@";
    assert.equal(
        computeRevisionDiffFallbackText(block, change),
        "renamed /tmp/inventory.py → /tmp/core_inventory.py (content unchanged)",
    );
});

test("test_computeRevisionDiffFallbackText_passes_real_diff_blocks_through", () => {
    // Scenario: a block with hunk lines renders as a diff, not as fallback text.
    // Steps:
    // assert a multi-line block yields undefined.
    const change = { path: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    const block = "@@ changed @ 2026-07-01T20:50:14.283Z @@\n@@ -1,2 +1,2 @@\n-old\n+new";
    assert.equal(computeRevisionDiffFallbackText(block, change), undefined);
});

test("test_computeToolActivityTag_tags_chip_carrying_blank_turns_as_tool_result", () => {
    // Scenario: an agent turn with no reply text but file chips is tool activity — the chips
    // show tool RESULTS (item 52; s39 Step 5).
    // Steps:
    // assert a blank-text agent turn with a file change is tagged "tool result".
    const change = { path: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: "", fileChanges: [change], gitOperations: [] }),
        "tool result",
    );
});

// (item 55) the "tool call" branch is retired — git rows moved out of agent-turn bubbles into
// standalone tool-call nodes, so a blank turn with only gitOperations no longer exists.
// test("test_computeToolActivityTag_tags_gitop_only_blank_turns_as_tool_call", () => {
//     // Scenario: a blank agent turn with only git rows shows the Bash tool CALLS that ran them.
//     // Steps:
//     // assert a blank-text agent turn with a git operation and no chips is tagged "tool call".
//     const operation = { kind: GitOperationKind.commit, when: "2026-01-01T00:00:00.000Z" };
//     assert.equal(
//         computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: " ", fileChanges: [], gitOperations: [operation] }),
//         "tool call",
//     );
// });

test("test_computeToolActivityTag_ignores_gitop_only_blank_turns", () => {
    // Scenario (item 55): git rows are standalone tool-call nodes now — a blank agent turn whose
    // only content is gitOperations gets NO tag (the old "tool call" tag is retired).
    // Steps:
    // assert a blank-text agent turn with a git operation and no chips is untagged.
    const operation = { kind: GitOperationKind.commit, when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: " ", fileChanges: [], gitOperations: [operation] }),
        undefined,
    );
});

test("test_computeToolActivityTag_ignores_replies_and_user_turns", () => {
    // Scenario: real replies (non-blank text) and user turns are never tool activity.
    // Steps:
    // assert a texted agent turn with chips gets no tag; a user turn gets no tag.
    const change = { path: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
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
    // Scenario: tool rows stay single-line so the [{ }] <TS> L:n parts remain visible — long
    // summaries truncate to 50 chars plus an ellipsis, multi-line summaries keep line one only.
    // Steps:
    // assert a 120-char summary truncates to 50 chars + ellipsis.
    const longSummary = "x".repeat(120);
    assert.equal(truncateToolCallSummary(longSummary), `${"x".repeat(50)}…`);
    // assert a short summary passes through unchanged.
    assert.equal(truncateToolCallSummary("git init"), "git init");
    // assert only the first line of a multi-line summary is used.
    assert.equal(truncateToolCallSummary("line one\nline two"), "line one");
});

// ── item 66: fork-style view-model helpers ───────────────────────────────────────────────────────
