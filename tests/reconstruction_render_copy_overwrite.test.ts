import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVerbose } from "../src/reconstruction_render.ts";
import { renderDiff } from "../src/reconstruction_render_diff.ts";
import type { FileRevision } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { born } from "./reconstruction_render-test-helpers.ts";

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
