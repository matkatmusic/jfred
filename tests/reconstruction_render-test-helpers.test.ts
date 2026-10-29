import { test } from "node:test";
import assert from "node:assert/strict";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import {
    createBornLine,
    createCarriedLine,
    createThenDelete,
    createThenAppendRevs,
    createRenameEdit,
    FROM,
    TO,
} from "./reconstruction_render-test-helpers.ts";

const WHEN = new Date("2026-01-01T00:00:00Z");

test("createCarriedLine keeps the previous index and the given line", () => {
    const entry = createCarriedLine(3, "x", WHEN);

    assert.equal(entry.oldLineNum, 3);
    assert.deepEqual(entry.values, [{ line: "x", timestamp: WHEN }]);
});

test("createBornLine has no predecessor", () => {
    const entry = createBornLine("y", WHEN);

    assert.equal(entry.oldLineNum, DOES_NOT_EXIST_YET);
    assert.deepEqual(entry.values, [{ line: "y", timestamp: WHEN }]);
});

test("createThenDelete creates two lines, then deletes them", () => {
    const revisions = createThenDelete();

    assert.deepEqual(revisions.map((revision) => revision.kind), [EventKind.write, EventKind.delete]);
    assert.equal(revisions[0]!.lines.length, 2);
    assert.equal(revisions[1]!.lines.length, 0);
});

test("createThenAppendRevs appends one line after the first", () => {
    const revisions = createThenAppendRevs();

    assert.deepEqual(revisions.map((revision) => revision.kind), [EventKind.write, EventKind.append]);
    assert.equal(revisions[1]!.lines[0]!.oldLineNum, 0);
    assert.equal(revisions[1]!.lines[1]!.oldLineNum, DOES_NOT_EXIST_YET);
});

test("createRenameEdit renames FROM to TO, then edits", () => {
    const revisions = createRenameEdit();

    assert.deepEqual(revisions.map((revision) => revision.kind), [EventKind.write, EventKind.rename, EventKind.edit]);
    assert.equal(revisions[1]!.rename!.from, FROM);
    assert.equal(revisions[1]!.rename!.to, TO);
    assert.equal(revisions[2]!.lines.length, 6);
});
