import { test } from "node:test";
import assert from "node:assert/strict";
import {
    renderVerbose,
    renderDiff,
} from "../src/reconstruction_render.ts";
import type { FileRevision } from "../src/reconstruction_engine.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { beforeDiffHunkHeader } from "../src/regex_expressions.ts";
import {
    born,
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

// --- s3-copy-file: copy entry rendering --------------------------------------

// A copy genesis revision for s3_copy.py (two lines, copy provenance).
const copyRevisionFixture: FileRevision = {
    kind: EventKind.copy,
    changeId: new Uuid("toolu_01JD5DoUCPtnnQrnJpSDmHwf"),
    timestamp: new Date("2026-06-18T16:16:27.224Z"),
    lines: [
        { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line: "def hello():", timestamp: new Date("2026-06-18T16:16:27.224Z") }] },
        { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line: '    print("hello")', timestamp: new Date("2026-06-18T16:16:27.224Z") }] },
    ],
    copy: { from: new Path("/x/s3_source.py"), to: new Path("/x/s3_copy.py") },
};

// The list view's copy-entry test lives in reconstruction_render_list.test.ts.

// The diff view shows a copy as its own block with its lines as additions.
test("test_diff_shows_copy_as_its_own_block_with_added_lines", () => {
    // Render the diff for a lone copy revision.
    const output = renderDiff([copyRevisionFixture]);
    // It is a copied block naming both paths.
    assert.ok(output.includes("copied"));
    assert.ok(output.includes("s3_source.py"));
    assert.ok(output.includes("s3_copy.py"));
    // Its genesis lines appear as additions.
    assert.ok(output.includes("+ def hello():"));
});

// The verbose view labels the copy entry, shows the arrow, and lists its body.
test("test_verbose_labels_copy_entry_with_arrow_and_body", () => {
    // Render the verbose state for a lone copy revision.
    const output = renderVerbose([copyRevisionFixture]);
    // It is labelled copy, shows the arrow, and lists the body lines.
    assert.ok(output.includes("copy"));
    assert.ok(output.includes("→"));
    assert.ok(output.includes("def hello():"));
});

// --- s4-overwrite-file: overwrite entry rendering ----------------------------

// A create then overwrite, from literals (local to this file's diff/verbose tests).
function createThenOverwriteRevs(): FileRevision[] {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const v1 = ["def version1():", "    return 1"].map((line) => born(line, t0));
    const v2 = ["def version2():", "    return 2"].map((line) => born(line, t1));
    return [
        { kind: EventKind.write, changeId: new Uuid("w1"), timestamp: t0, lines: v1 },
        { kind: EventKind.overwrite, changeId: new Uuid("w2"), timestamp: t1, lines: v2 },
    ];
}

// --diff heads an overwrite "overwritten" and shows a full replace (all out, all in).
test("test_diff_shows_overwrite_as_full_replace", () => {
    const out = renderDiff(createThenOverwriteRevs());
    assert.ok(out.includes("overwritten"));
    // Every old line is removed and every new line added (a wholesale rewrite).
    assert.ok(out.includes("- def version1():"));
    assert.ok(out.includes("+ def version2():"));
});

// --verbose shows the overwrite's full new line state (default full-state body).
test("test_verbose_shows_overwrite_full_state", () => {
    const out = renderVerbose(createThenOverwriteRevs());
    assert.ok(out.includes("def version2():"));
    assert.ok(out.includes("    return 2"));
});
