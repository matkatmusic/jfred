// Task 330 (S18/S19): fixture mode serves the real Layer 1 page from canned payloads, never reading ~/.claude or git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
// import { COMMITS } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureLayer1View } from "../src/viewer_api_layer1_fixture_view.ts";
import { listContentLines } from "../src/viewer_api_layer1_fixture_content.ts";
import { buildLayer1DiffPayload } from "../src/viewer_api_layer1_diff.ts";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dispatchLayer1FixtureRoute } from "../src/viewer_api_layer1_fixture.ts";
import { buildFixtureScriptRunsPayload } from "../src/viewer_api_layer4_fixture_payload.ts";
import { FIXTURE_RUN_ID } from "../src/viewer_api_layer6_fixture_blocked_runs.ts";
import { savedFixtureRuns } from "../src/viewer_api_layer6_fixture_needs.ts";

// not behavior: it only checks that a fixture constant array is non-empty.
// test("test_fixture_data_module_imports_without_throwing", () => {
//     // The self-check throws at import time; reaching here proves it passed on the full fixture.
//     assert.ok(COMMITS.length > 0, "the ported COMMITS array is populated");
// });

test("test_fixture_view_axis_offsets_accumulate", () => {
    // Scenario: every axisPx comes from ONE computeNodeLadderLayout call, so offsets must only ever rise.
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
        listContentLines("src/util.ts", { kind: "snapshot", version: "@v2", session: basename(snapshot.sessionFile.toString()) }).join("\n"));
    assert.notEqual(bytes[0], bytes[1], "the two @v2 revisions have different bytes");
});

test("test_the_base_fixture_view_stays_free_of_edits", () => {
    // Scenario: edits arrive only from /api/layer1-edits, so no pair of the base view carries the key.
    const view = buildFixtureLayer1View();
    assert.ok(view.pairs.every((pair) => !("edits" in pair)), "no pair carries an edits key");
});

test("test_the_base_fixture_view_stays_free_of_script_runs", () => {
    // Scenario: script runs arrive only from /api/layer1-script-runs, so no pair of the base view carries the key.
    const view = buildFixtureLayer1View();
    assert.ok(view.pairs.every((pair) => !("scriptRuns" in pair)), "no pair carries a scriptRuns key");
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

function postFixtureRoute(pathname: string, payload: object): Promise<string> {
    const request = new EventEmitter() as unknown as IncomingMessage;
    (request as { method: string }).method = "POST";
    return new Promise((resolve) => {
        let text = "";
        const response = {
            writeHead: () => undefined,
            write: (chunk: string) => {
                text += chunk;
            },
            end: (chunk?: string) => {
                text += chunk ?? "";
                resolve(text);
            },
            on: () => undefined,
        } as unknown as ServerResponse;
        const isHandled = dispatchLayer1FixtureRoute(request, response, new URL(`http://localhost${pathname}`));
        assert.equal(isHandled, true);
        request.emit("data", Buffer.from(JSON.stringify(payload)));
        request.emit("end");
    });
}

test("test_the_script_run_route_answers_consent_required_without_allow_scripts", async () => {
    const text = await postFixtureRoute("/api/layer1-script-run", { sessionFile: "x.jsonl", toolUseId: FIXTURE_RUN_ID.pre, allowScripts: false });
    assert.deepEqual(JSON.parse(text.trim()), { kind: "consent-required" });
});

test("test_the_script_needs_route_lists_the_blocker_of_the_blocked_run", async () => {
    savedFixtureRuns.clear();
    const text = await postFixtureRoute("/api/layer1-script-needs", { sessionFile: "x.jsonl", toolUseId: FIXTURE_RUN_ID.blocked });
    const reply = JSON.parse(text) as { toolUseId: string; needs: { toolUseId: string }[] };
    assert.deepEqual(reply.needs.map((need) => need.toolUseId), [FIXTURE_RUN_ID.blocker]);
});

test("test_the_clear_results_route_empties_the_saved_runs", async () => {
    savedFixtureRuns.add(FIXTURE_RUN_ID.blocker);
    const text = await postFixtureRoute("/api/layer1-clear-results", {});
    assert.deepEqual(JSON.parse(text), { cleared: true });
    assert.equal(savedFixtureRuns.size, 0);
});

test("test_the_blocker_precedes_the_blocked_run_in_a_bubble_the_blocked_run_does_not_touch", () => {
    const view = buildFixtureLayer1View();
    const pairPaths = view.pairs.map((pair) => pair.path.toString());
    const payload = buildFixtureScriptRunsPayload(() => undefined);
    const pairsOf = (id: string) => payload.pairs.filter((pair) => pair.scriptRuns.some((run) => run.toolUseId.toString() === id));
    const instantOf = (id: string) => payload.pairs.flatMap((pair) => pair.scriptRuns).find((run) => run.toolUseId.toString() === id)!.instant.getTime();
    const couples = [[FIXTURE_RUN_ID.blocker, FIXTURE_RUN_ID.blocked], [FIXTURE_RUN_ID.crashBlocker, FIXTURE_RUN_ID.crashBlocked]];
    for (const [blockerId, blockedId] of couples) {
        const blockerPaths = pairsOf(blockerId!).map((pair) => pair.path.toString());
        const blockedPaths = pairsOf(blockedId!).map((pair) => pair.path.toString());
        assert.ok(blockerPaths.length > 0 && blockedPaths.length > 0, "both runs sit on a pair path of the view");
        assert.ok(blockerPaths.every((path) => pairPaths.includes(path)) && blockedPaths.every((path) => pairPaths.includes(path)));
        assert.ok(blockerPaths.every((path) => !blockedPaths.includes(path)), "the blocker bubble is not touched by the blocked run");
        assert.ok(instantOf(blockerId!) < instantOf(blockedId!), "the blocker comes first in time");
    }
});

