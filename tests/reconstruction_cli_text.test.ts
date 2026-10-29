import { test } from "node:test";
import assert from "node:assert/strict";
import { Uuid } from "../src/structures/domain.ts";
import type { BranchedReconstruction } from "../src/reconstruction_engine.ts";
import { assertStepInRange, listAvailableBranchIds } from "../src/reconstruction_cli_text.ts";

test("test_assert_step_in_range_accepts_first_and_last_step", () => {
    assertStepInRange(1, 3);
    assertStepInRange(3, 3);
});

test("test_assert_step_in_range_rejects_zero_and_past_the_end", () => {
    assert.throws(() => assertStepInRange(0, 3), /step must be in 1\.\.3/);
    assert.throws(() => assertStepInRange(4, 3), /step must be in 1\.\.3/);
});

test("test_list_available_branch_ids_names_surviving_then_rewound_tips", () => {
    const branched = {
        survivingTip: new Uuid("aaaaaaaa-1111"),
        surviving: [],
        rewound: [{ tip: new Uuid("bbbbbbbb-2222"), histories: [] }],
    } as unknown as BranchedReconstruction;
    assert.equal(listAvailableBranchIds(branched), "surviving (#aaaaaaaa), #bbbbbbbb");
});
