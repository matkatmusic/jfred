import { test } from "node:test";
import assert from "node:assert/strict";
import { findBranchById, getShortUuid } from "../src/reconstruction_branch_lookup.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { BranchedReconstruction } from "../src/reconstruction_engine.ts";

test("test_short_uuid_keeps_first_eight_characters", () => {
    assert.equal(getShortUuid(new Uuid("0123456789abcdef")), "01234567");
});

test("test_find_branch_by_id_resolves_surviving_and_rewound_ids", () => {
    const tip = new Uuid("fedcba9876543210");
    const branched: BranchedReconstruction = {
        survivingTip: undefined,
        surviving: [],
        rewound: [{ rewindPoint: new Uuid("r"), tip, histories: [] }],
    };
    assert.equal(findBranchById(branched, "surviving"), branched.surviving);
    assert.equal(findBranchById(branched, "fedcba98"), branched.rewound[0]!.histories);
    assert.equal(findBranchById(branched, "missing"), undefined);
});
