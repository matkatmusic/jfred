// Unit tests for src/reconstruction_line_verdicts.ts (buildLineVerdicts moved to its own
// canonical home when task 134 pushed reconstruction_json.ts past the 250-line cap). Same
// fixture shape as tests/reconstruction_json.test.ts: loadRecords + S19_JSONL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLineVerdicts } from "../src/reconstruction_line_verdicts.ts";
import { isGenuineUserPrompt } from "../src/reconstruction_prompts.ts";
import { RecordType, Verdict } from "../src/structures/vocabulary.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

const records = loadRecords(S19_JSONL);

test("test_buildLineVerdicts_one_entry_per_record_in_file_order", () => {
    // Behavior: one entry per parsed record, line === array index.
    const verdicts = buildLineVerdicts(records);
    // Verify.
    assert.equal(verdicts.length, records.length);
    verdicts.forEach((v, i) => assert.equal(v.line, i));
});

test("test_line_verdicts_carry_timestamp_and_session_id", () => {
    // Behavior (task 134): each entry surfaces its record's hydrated envelope timestamp and
    // sessionId (undefined when the record lacks them) — the timeline's raw-line rows need
    // both to sort chronologically and tint their session lane.
    const verdicts = buildLineVerdicts(records);
    // Verify: pure surfacing — same Date / Uuid objects the record carries, index-aligned.
    verdicts.forEach((verdict, index) => {
        assert.equal(verdict.timestamp, records[index]!.timestamp);
        assert.equal(verdict.sessionId, records[index]!.sessionId);
    });
    // At least one record in the fixture actually carries both, so the assertions above bite.
    assert.ok(verdicts.some((verdict) => verdict.timestamp !== undefined && verdict.sessionId !== undefined));
});

test("test_buildLineVerdicts_classifies_each_line", () => {
    // Behavior: every entry's verdict is a Verdict member; a genuine prompt flips isGenuinePrompt.
    const verdicts = buildLineVerdicts(records);
    const verdictValues = new Set(Object.values(Verdict));
    // Verify: all verdicts valid; a genuine user prompt is flagged, a non-prompt user record is not.
    for (const v of verdicts) {
        assert.ok(verdictValues.has(v.verdict));
    }
    const genuineIndex = records.findIndex((r) => isGenuineUserPrompt(r));
    assert.equal(verdicts[genuineIndex]!.isGenuinePrompt, true);
    const nonPromptIndex = records.findIndex(
        (r) => r.type === RecordType.user && !isGenuineUserPrompt(r),
    );
    if (nonPromptIndex >= 0) {
        assert.equal(verdicts[nonPromptIndex]!.isGenuinePrompt, false);
    }
});
