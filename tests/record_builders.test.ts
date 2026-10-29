import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserTextRecord } from "./record_builders.ts";

test("buildUserTextRecord links the record to its parent", () => {
    const record = buildUserTextRecord("u1", "p0", "hi", "2026-01-01T00:00:10Z");
    assert.equal(record.parentUuid?.toString(), "p0");
});
