import { test } from "node:test";
import assert from "node:assert/strict";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";

test("test_does_not_exist_yet_is_negative_so_no_real_line_number_matches", () => {
    // Scenario: the genesis sentinel never equals a real 1-based line number.
    assert.ok(DOES_NOT_EXIST_YET < 1);
});
