import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVerbose } from "../src/reconstruction_render.ts";
import { renderDiff } from "../src/reconstruction_render_diff.ts";
import { beforeDiffHunkHeader } from "../src/regex_expressions.ts";
import {
    createThenDelete,
    createThenAppendRevs,
    createRenameEdit,
    FROM,
    TO,
} from "./reconstruction_render-test-helpers.ts";

// --verbose lists each line of the create revision and shows the delete as empty.
test("test_verbose_lists_lines_then_shows_zero", () => {
    const out = renderVerbose(createThenDelete());
    assert.ok(out.includes("def hello():"));
    assert.ok(out.includes('    print("hello")'));
    assert.ok(out.includes("0 lines"));
    assert.ok(out.includes("file absent"));
});

// --verbose numbers lines from 1.
test("test_verbose_numbers_lines_from_one", () => {
    const out = renderVerbose(createThenDelete());
    assert.ok(out.includes("1 | def hello():"));
    assert.ok(out.includes('2 |     print("hello")'));
});

// --diff shows the create as additions and the delete as removals.
test("test_diff_shows_additions_then_removals", () => {
    const out = renderDiff(createThenDelete());
    assert.ok(out.includes("+ def hello():"));
    assert.ok(out.includes("- def hello():"));
    assert.ok(out.includes("created"));
    assert.ok(out.includes("deleted"));
});

// The diff block headed `@@ appended …`, isolated from the full multi-block diff.
function appendedBlockOf(diff: string): string {
    const blocks = diff.split(beforeDiffHunkHeader);
    return blocks.find((block) => block.startsWith("@@ appended"))!;
}

// --diff heads an append "appended" and shows only the new tail line (prefix unchanged).
test("test_diff_shows_append_as_added_tail_only", () => {
    const block = appendedBlockOf(renderDiff(createThenAppendRevs()));
    assert.ok(block.includes("appended"));
    assert.ok(block.includes("+ line two"));
    // Within the append block the carried prefix is not re-emitted as an add or a remove.
    assert.ok(!block.includes("+ line one"));
    assert.ok(!block.includes("- line one"));
});

// --- s2-move-file: rename entry + oldLineNum-driven edit diffs ----------------

// --diff shows the rename as its own block naming both paths, with no churn.
test("test_diff_shows_rename_entry_as_first_class_block", () => {
    const [create, rename] = createRenameEdit();
    const out = renderDiff([create!, rename!]);
    assert.ok(out.includes("renamed"));
    assert.ok(out.includes(FROM.toString()));
    assert.ok(out.includes(TO.toString()));
    // The rename block churns no content lines.
    assert.ok(!out.includes("- def hello():"));
});

// --diff for an edit shows only the inserted lines, not a remove-all/add-all.
test("test_diff_shows_only_inserted_lines_for_an_edit", () => {
    const [, rename, edit] = createRenameEdit();
    const out = renderDiff([rename!, edit!]);
    assert.ok(out.includes("+ def goodbye():"));
    // The two unchanged context lines are not removed.
    assert.ok(!out.includes("- def hello():"));
    assert.ok(!out.includes('-     print("hello")'));
});

// --verbose labels the rename entry by kind and shows its from -> to.
test("test_verbose_labels_rename_entry", () => {
    const [create, rename] = createRenameEdit();
    const out = renderVerbose([create!, rename!]);
    assert.ok(out.includes("rename"));
    assert.ok(out.includes("→"));
});
