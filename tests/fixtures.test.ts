import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { S1_JSONL } from "./fixtures.ts";

test("test_s1_fixture_transcript_exists_on_disk", () => {
    // Scenario: the s1 scenario transcript the suite reads from is present, so a moved or missing fixture fails here with a clear message rather than as an opaque read error inside every other test.
    assert.ok(existsSync(S1_JSONL), `missing s1 fixture: ${S1_JSONL}`);
});

