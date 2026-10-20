import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBulkFixture } from "../src/viewer_api_fixture_bulk.ts";
import { COMMITS, DISK, SESSIONS } from "../src/viewer_api_layer1_fixture_data.ts";
import { SNAPSHOTS } from "../src/viewer_api_layer2_fixture_data.ts";

test("the bulk generator fills all four arrays, 84 files' worth", () => {
    assert.equal(DISK.filter((entry) => entry.path.includes("module_")).length, 84);
    assert.ok(COMMITS.length > 84);
    assert.ok(SESSIONS.some((session) => session.file.startsWith("bulk-")));
    assert.ok(SNAPSHOTS.some((snapshot) => snapshot.session.startsWith("bulk-")));
});

test("the self-check throws on a snapshot born before its file", () => {
    const target = {
        commits: [],
        disk: [{ path: "a.ts", born: "2026-01-02T00:00:00Z", at: "2026-01-03T00:00:00Z" }],
        sessions: [],
        snapshots: [{ path: "a.ts", version: "@v1", at: "2026-01-01T00:00:00Z", session: "x.jsonl", line: 1 }],
    };
    assert.throws(() => buildBulkFixture(target), /before born/);
});
