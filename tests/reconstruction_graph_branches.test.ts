import { test } from "node:test";
import assert from "node:assert/strict";
import {
    selectRecordsOutsideUuids,
    splitSurvivingBranch,
} from "../src/reconstruction_graph_branches.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { ConversationBranch } from "../src/reconstruction_branch.ts";

test("test_split_surviving_branch_keeps_first_surviving_and_all_rewound", () => {
    const first: ConversationBranch = { tip: new Uuid("t1"), rewindPoint: undefined, isSurviving: true };
    const second: ConversationBranch = { tip: new Uuid("t2"), rewindPoint: undefined, isSurviving: true };
    const rewound: ConversationBranch = { tip: new Uuid("t3"), rewindPoint: new Uuid("r"), isSurviving: false };
    const split = splitSurvivingBranch([rewound, first, second]);
    assert.equal(split.surviving, first);
    assert.deepEqual(split.rewound, [rewound]);
});

test("test_select_records_outside_uuids_drops_excluded_and_uuidless_records", () => {
    const keep = { type: RecordType.user, uuid: new Uuid("a") } as unknown as TranscriptRecord;
    const drop = { type: RecordType.user, uuid: new Uuid("b") } as unknown as TranscriptRecord;
    const meta = { type: RecordType.mode } as TranscriptRecord;
    assert.deepEqual(selectRecordsOutsideUuids([keep, drop, meta], new Set(["b"])), [keep]);
});
