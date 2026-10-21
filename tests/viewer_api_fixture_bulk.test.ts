import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBulkFixture } from "../src/viewer_api_fixture_bulk.ts";
import { COMMITS, DISK, SESSIONS } from "../src/viewer_api_layer1_fixture_data.ts";
import { SNAPSHOTS } from "../src/viewer_api_layer2_fixture_data.ts";
import { EDITS } from "../src/viewer_api_layer3_fixture_data.ts";

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
        edits: [],
        scriptRuns: [],
    };
    assert.throws(() => buildBulkFixture(target), /before born/);
});

test("the bulk generator adds a Read and an Edit to every file but each sixth", () => {
    const bulkEvents = EDITS.filter((event) => event.session.startsWith("bulk-"));
    const bulkPaths = new Set(bulkEvents.map((event) => event.path));
    assert.equal(bulkPaths.size, 70);
    assert.equal(bulkEvents.length, 140);
    assert.equal(bulkEvents.filter((event) => event.kind === "read").length, 70);
    assert.ok(!bulkPaths.has("docs/guides/module_05.md"));
    assert.ok(bulkPaths.has("src/api/module_00.ts"));
});
