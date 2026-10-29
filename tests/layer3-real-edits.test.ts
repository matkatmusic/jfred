// Tests for the payload readers in scripts/visual/layer3-real-edits.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { containsCounterLabel, findUncertainEdit, listAllEdits, listEditsOnPaths } from "../scripts/visual/layer3-real-edits.ts";

const payload = {
    pairs: [
        { path: "a.ts", edits: [{ changeId: "c1", confidence: "verified" }] },
        { path: "b.ts", edits: [{ changeId: "c2", confidence: "derived" }, { changeId: "c3", confidence: "verified" }] },
    ],
} as never;

test("listAllEdits flattens every pair's edits in order", () => {
    assert.deepEqual(listAllEdits(payload).map((edit) => edit.changeId), ["c1", "c2", "c3"]);
});

test("listEditsOnPaths keeps only edits on the given paths", () => {
    assert.deepEqual(listEditsOnPaths(payload, new Set(["b.ts"])).map((edit) => edit.changeId), ["c2", "c3"]);
});

test("findUncertainEdit returns the first non-verified edit or undefined", () => {
    assert.equal(findUncertainEdit(payload)?.changeId, "c2");
    assert.equal(findUncertainEdit({ pairs: [] } as never), undefined);
});

test("containsCounterLabel matches an n / m label", () => {
    assert.equal(containsCounterLabel(["loading", "3 / 10"]), true);
    assert.equal(containsCounterLabel(["loading"]), false);
});
