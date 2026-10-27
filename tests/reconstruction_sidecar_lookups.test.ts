// Pure lookups for the sidecar reader: distinct session ids and declared sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { collectSessionIds, findMatchingSourceEntry } from "../src/reconstruction_sidecar_lookups.ts";

const SESSION_A = new Uuid("aaaaaaaa-1111-2222-3333-444444444444");
const SESSION_B = new Uuid("bbbbbbbb-1111-2222-3333-444444444444");

test("test_collect_session_ids_returns_distinct_ids_in_first_seen_order", () => {
    const records = [{ sessionId: SESSION_B }, { sessionId: SESSION_A }, { sessionId: SESSION_B }, {}] as unknown as TranscriptRecord[];
    const ids = collectSessionIds(records);
    assert.deepEqual(ids.map((id) => id.toString()), [SESSION_B.toString(), SESSION_A.toString()]);
});

test("test_find_matching_source_entry_matches_normalized_projects_dir", () => {
    const first = { projectsDir: new Path("/tree-a/projects") };
    const second = { projectsDir: new Path("/tree-b/projects") };
    assert.equal(findMatchingSourceEntry([first, second], "/tree-b/other/../projects"), second);
    assert.equal(findMatchingSourceEntry([first, second], "/tree-c/projects"), undefined);
});
