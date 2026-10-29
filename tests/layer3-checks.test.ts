// Tests for the pure label helper in scripts/visual/layer3-checks.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isNonEmptyAllEqual } from "../scripts/visual/layer3-checks.ts";

test("isNonEmptyAllEqual is true when every text matches", () => {
    assert.equal(isNonEmptyAllEqual(["[e]", "[e]"], "[e]"), true);
});

test("isNonEmptyAllEqual is false for an empty list", () => {
    assert.equal(isNonEmptyAllEqual([], "[e]"), false);
});

test("isNonEmptyAllEqual is false when one text differs", () => {
    assert.equal(isNonEmptyAllEqual(["[e]", "[R]"], "[e]"), false);
});
