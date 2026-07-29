// tests/reconstruction_lineage_inputs.test.ts — the static half of the task-220 horizon: the strictly-before instant search and the per-target static lineage inputs.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    findLatestInstantBefore,
    getStaticInputsForTarget,
} from "../src/reconstruction_lineage_inputs.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

test("test_find_latest_instant_before_returns_last_strictly_earlier_instant", () => {
    // Scenario: the binary search returns the largest instant strictly before the probe,
    // and -1 when nothing precedes it (an equal instant is NOT before).
    assert.equal(findLatestInstantBefore([1000, 2000], 1500), 1000);
    assert.equal(findLatestInstantBefore([1000, 2000], 3000), 2000);
    assert.equal(findLatestInstantBefore([1000, 2000], 1000), -1);
    assert.equal(findLatestInstantBefore([], 1500), -1);
    assert.equal(findLatestInstantBefore([1000], 1001), 1000);
});

test("test_static_inputs_collect_own_instants_and_lineage_paths", () => {
    // Scenario: two Writes of the target and one Write of an unrelated file — the target's static inputs carry exactly its own two instants, and its path string.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/unrelated.txt", content: "g\n" }, "2026-01-01T00:00:02Z", "/proj"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v2\n" }, "2026-01-01T00:00:03Z", "/proj"),
    ];
    const inputs = getStaticInputsForTarget(records, new Path("/proj/plate.py"));
    assert.deepEqual(inputs.ownInstantsMs, [
        new Date("2026-01-01T00:00:01Z").getTime(),
        new Date("2026-01-01T00:00:03Z").getTime(),
    ]);
    assert.ok(inputs.lineagePathStrings.includes("/proj/plate.py"));
    assert.ok(!inputs.lineagePathStrings.includes("/proj/unrelated.txt"));
});
