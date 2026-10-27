// Step tags, diff fallback text, tool-activity tags, and summaries, from wire-shape inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeRevisionDiffFallbackText,
    computeToolActivityTag,
    computeUnattributedStepTag,
} from "../webapp/views/timeline-labels-tags.ts";
import { trimToolCallSummary } from "../webapp/views/timeline-labels.ts";
import {
    AGENT_TURN_NODE_KIND,
    USER_TURN_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import {
    EventKind,
} from "../src/structures/vocabulary.ts";
import {
    GitOperationKind,
} from "../src/structures/vocabulary_views.ts";

test("test_computeUnattributedStepTag_names_a_single_event_kind", () => {
    // One chip kind yields a humanized tag; script-execution has its own wording.
    assert.equal(computeUnattributedStepTag(["user-edit"]), "user edit");
    assert.equal(computeUnattributedStepTag(["script-execution"]), "script run");
});

test("test_computeUnattributedStepTag_joins_distinct_kinds", () => {
    // Repeated kinds dedupe; distinct kinds join in first-seen order.
    assert.equal(computeUnattributedStepTag(["user-edit", "user-edit", "write"]), "user edit · write");
});

test("test_computeUnattributedStepTag_returns_undefined_for_no_kinds", () => {
    // A chipless step must yield undefined, never an empty span.
    assert.equal(computeUnattributedStepTag([]), undefined);
});

test("test_computeRevisionDiffFallbackText_explains_a_missing_block", () => {
    // The +/- drawer got no block for this revision.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.rename, renamedFrom: undefined, isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(computeRevisionDiffFallbackText(undefined, change), "(no diff block for this revision)");
});

test("test_computeRevisionDiffFallbackText_explains_a_rename_block", () => {
    // Renames have no diff body, so a header-only block needs fallback text.
    const change = { path: "/tmp/core_inventory.py", displayPath: "/tmp/core_inventory.py", eventKind: EventKind.rename, renamedFrom: "/tmp/inventory.py", isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    const block = "@@ renamed /tmp/inventory.py → /tmp/core_inventory.py @ 2026-07-01T20:51:55.964Z @@";
    assert.equal(
        computeRevisionDiffFallbackText(block, change),
        "renamed /tmp/inventory.py → /tmp/core_inventory.py (content unchanged)",
    );
});

test("test_computeRevisionDiffFallbackText_passes_real_diff_blocks_through", () => {
    // A block with hunk lines renders as a diff.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: false, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    const block = "@@ changed @ 2026-07-01T20:50:14.283Z @@\n@@ -1,2 +1,2 @@\n-old\n+new";
    assert.equal(computeRevisionDiffFallbackText(block, change), undefined);
});

test("test_computeToolActivityTag_tags_chip_carrying_blank_turns_as_tool_result", () => {
    // A textless agent turn carrying chips is tool activity.
    const change = { path: "/tmp/a.py", displayPath: "/tmp/a.py", eventKind: EventKind.overwrite, renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: "", fileChanges: [change], gitOperations: [] }),
        "tool result",
    );
});

// Git rows are standalone nodes, so blank turns with only gitOperations no longer exist.

test("test_computeToolActivityTag_ignores_gitop_only_blank_turns", () => {
    // The old "tool call" tag is retired for git-only turns.
    const operation = { kind: GitOperationKind.commit, when: "2026-01-01T00:00:00.000Z" };
    assert.equal(
        computeToolActivityTag({ kind: AGENT_TURN_NODE_KIND, text: " ", fileChanges: [], gitOperations: [operation] }),
        undefined,
    );
});

test("test_computeToolActivityTag_ignores_replies_and_user_turns", () => {
    // Real replies and user turns are never tool activity.
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
    // Tool rows stay single-line so the other row parts remain visible.
    const longSummary = "x".repeat(120);
    assert.equal(trimToolCallSummary(longSummary), `${"x".repeat(50)}…`);
    assert.equal(trimToolCallSummary("git init"), "git init");
    assert.equal(trimToolCallSummary("line one\nline two"), "line one");
});
