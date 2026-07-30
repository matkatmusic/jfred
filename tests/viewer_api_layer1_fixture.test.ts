// Task 330 (spec S18/S19): fixture mode — the real Layer 1 page served from canned payloads.
//
// Capture-free: reads only the ported fixture arrays and the pure axis layout, never ~/.claude or git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { COMMITS } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { contentLines } from "../src/viewer_api_layer1_fixture_content.ts";
import { buildLayer1DiffPayload } from "../src/viewer_api_layer1_diff.ts";

test("test_fixture_data_module_imports_without_throwing", () => {
    // The self-check throws at import time; reaching here proves it passed on the full fixture.
    assert.ok(COMMITS.length > 0, "the ported COMMITS array is populated");
});

test("test_fixture_view_axis_offsets_accumulate", () => {
    // Scenario: every axisPx comes from ONE layOutNodeLadders call, so offsets must only ever rise.
    const view = buildFixtureLayer1View();
    const assertAscends = (path: unknown, label: string, run: number[]): void => {
        for (let node = 1; node < run.length; node += 1) {
            assert.ok(run[node]! >= run[node - 1]!, `${path} ${label} node ${node} descends`);
        }
    };
    for (const pair of view.pairs) {
        // Snapshots are APPENDED, never interleaved (listPairNodeLadder), so each run ascends separately.
        assertAscends(pair.path, "prefix", [
            ...(pair.created === undefined ? [] : [pair.created.axisPx]),
            ...pair.commits.map((commit) => commit.axisPx),
            pair.onDisk.axisPx,
        ]);
        assertAscends(pair.path, "snapshots", (pair.snapshots ?? []).map((snapshot) => snapshot.axisPx));
    }
    // Each ruler tick sits at or below the next: the shared axis is monotonic across every bubble.
    for (let tick = 1; tick < view.ruler.length; tick += 1) {
        assert.ok(view.ruler[tick]!.axisPx >= view.ruler[tick - 1]!.axisPx, `ruler tick ${tick} descends`);
    }
});

test("test_snapshot_free_pair_omits_the_snapshots_key", () => {
    // Scenario: README.md carries no snapshot, so its wire shape must be byte-identical to a Layer 1 pair.
    const view = buildFixtureLayer1View();
    const readme = view.pairs.find((pair) => pair.path.toString() === "README.md");
    assert.ok(readme !== undefined, "README.md is a paired file");
    // An absent-not-empty key: a `snapshots: []` would differ under the deep-equality the page relies on.
    assert.ok(!("snapshots" in readme!), "a snapshot-free pair omits the key entirely");
});

test("test_util_ts_carries_v2_from_two_different_sessions", () => {
    // Scenario: @vN is numbered per session, so src/util.ts holds @v2 twice — from two distinct sessions.
    const view = buildFixtureLayer1View();
    const util = view.pairs.find((pair) => pair.path.toString() === "src/util.ts");
    const versionTwos = (util?.snapshots ?? []).filter((snapshot) => snapshot.version === 2);
    // Two @v2 nodes, and their owning session files differ.
    assert.equal(versionTwos.length, 2, "src/util.ts carries two @v2 snapshots");
    const sessionFiles = versionTwos.map((snapshot) => basename(snapshot.sessionFile.toString()));
    assert.notEqual(sessionFiles[0], sessionFiles[1], "the two @v2 snapshots come from different sessions");
    // The content map keys on (path, version + owning session), so the two @v2 bodies must differ.
    const bytes = versionTwos.map((snapshot) =>
        contentLines("src/util.ts", { kind: "snapshot", version: "@v2", session: basename(snapshot.sessionFile.toString()) }).join("\n"));
    assert.notEqual(bytes[0], bytes[1], "the two @v2 revisions have different bytes");
});

test("test_identical_sides_with_full_context_answer_the_synthesized_hunk", () => {
    // Scenario: identical sides emit no git hunk, so the full-context toggle must synthesize a whole-file hunk.
    const lines = ["one", "two", "three"];
    const diff = buildLayer1DiffPayload(lines, lines, true);
    // A synthesized hunk opens with the full-file range header and carries every line as context.
    assert.ok(diff.startsWith("@@ -1,3 +1,3 @@"), diff);
    assert.ok(diff.includes(" one") && diff.includes(" three"), diff);
    // With the toggle OFF, identical sides stay empty.
    assert.equal(buildLayer1DiffPayload(lines, lines, false), "");
});

