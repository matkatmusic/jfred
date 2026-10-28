// Tests for the layer 4 payload: one progress line per run, pairs join runs to named paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFixtureScriptRunsPayload } from "../src/viewer_api_layer4_fixture_payload.ts";
import { SCRIPT_RUNS } from "../src/viewer_api_layer4_fixture_data.ts";

test("test_payload_writes_one_progress_line_per_script_run", () => {
    const lines: unknown[] = [];
    buildFixtureScriptRunsPayload((value) => lines.push(value));
    assert.equal(lines.length, SCRIPT_RUNS.length);
    assert.equal((lines[0] as { current: number }).current, 1);
    assert.equal((lines[lines.length - 1] as { current: number }).current, SCRIPT_RUNS.length);
});

test("test_payload_pairs_join_every_run_that_names_the_path", () => {
    const payload = buildFixtureScriptRunsPayload(() => undefined);
    assert.ok(payload.pairs.length > 0);
    for (const pair of payload.pairs) {
        const namingRuns = SCRIPT_RUNS.filter((run) => run.paths.includes(pair.path.toString()));
        assert.equal(pair.scriptRuns.length, namingRuns.length);
    }
});
