import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHistoryList } from "../src/reconstruction_render_list.ts";
import type { FileRevision } from "../src/reconstruction_engine.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// A copy genesis revision for s3_copy.py (two lines, copy provenance), local to
// this list-view test file.
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

// A create then an overwrite of the same two-line file, from literals.
function createThenOverwrite(): FileRevision[] {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const v1 = ["def version1():", "    return 1"].map((line) => ({ oldLineNum: DOES_NOT_EXIST_YET, values: [{ line, timestamp: t0 }] }));
    const v2 = ["def version2():", "    return 2"].map((line) => ({ oldLineNum: DOES_NOT_EXIST_YET, values: [{ line, timestamp: t1 }] }));
    return [
        { kind: EventKind.write, changeId: new Uuid("w1"), timestamp: t0, lines: v1 },
        { kind: EventKind.overwrite, changeId: new Uuid("w2"), timestamp: t1, lines: v2 },
    ];
}

// A create then an append of one tail line, from literals.
function createThenAppend(): FileRevision[] {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const v0 = [{ oldLineNum: DOES_NOT_EXIST_YET, values: [{ line: "line one", timestamp: t0 }] }];
    const v1 = [
        { oldLineNum: 0, values: [{ line: "line one", timestamp: t0 }] },
        { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line: "line two", timestamp: t1 }] },
    ];
    return [
        { kind: EventKind.write, changeId: new Uuid("w1"), timestamp: t0, lines: v0 },
        { kind: EventKind.append, changeId: new Uuid("a1"), timestamp: t1, lines: v1 },
    ];
}

// The list view labels the second entry an append, not a create or delete.
test("test_list_labels_append_entry", () => {
    const out = renderHistoryList([{ target: new Path("/a/s5_redirect.txt"), revisions: createThenAppend() }]);
    const appendLine = out.split("\n").find((line) => line.includes("#") && line.includes("append"))!;
    assert.ok(appendLine);
    assert.ok(!appendLine.includes("delete"));
});

// The list view labels the second entry an overwrite, not a create or delete.
test("test_list_labels_overwrite_entry", () => {
    const out = renderHistoryList([{ target: new Path("/a/s4_overwrite.py"), revisions: createThenOverwrite() }]);
    // The overwrite entry is labelled overwrite.
    assert.ok(out.includes("overwrite"));
    // It is not mislabelled delete (the entryLabel fall-through).
    const overwriteLine = out.split("\n").find((line) => line.includes("#") && line.includes("overwrite"))!;
    assert.ok(!overwriteLine.includes("delete"));
});

// The list view marks the copied file and labels its entry with the origin.
test("test_list_shows_copy_entry_with_provenance", () => {
    // Render the default list view for the copied file.
    const output = renderHistoryList([
        { target: new Path("/x/s3_copy.py"), revisions: [copyRevisionFixture] },
    ]);
    // The header marks it a copy of the source.
    assert.ok(output.includes("(copy of s3_source.py)"));
    // The entry is labelled copy and notes its origin.
    assert.ok(output.includes("copy"));
    assert.ok(output.includes("(copied from s3_source.py)"));
});

