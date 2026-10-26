import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeScriptExecutionChangeId,
    getScriptRunSourceIdFromChangeId,
    type ScriptRun,
} from "../src/reconstruction_script_execution.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

test("test_computeScriptExecutionChangeId_is_deterministic_for_same_run_and_target", () => {
    // Item 34: the two replays derive the id independently, so both must yield the same value.
    const run: ScriptRun = {
        code: "python3 apply_renames.py",
        timestamp: new Date("2026-07-01T20:53:49.772Z"),
        toolUseId: new Uuid("toolu_01GkePu7Mj4DmkPivZapZB8z"),
    };
    const target = new Path("/tmp/demo/core_inventory.py");
    const firstChangeId = computeScriptExecutionChangeId(run, target);
    const secondChangeId = computeScriptExecutionChangeId(run, target);
    assert.equal(firstChangeId.toString(), secondChangeId.toString());
});

test("test_computeScriptExecutionChangeId_differs_per_target", () => {
    // Two targets must yield distinct ids so each file's synthetic event stays addressable.
    const run: ScriptRun = {
        code: "python3 apply_renames.py",
        timestamp: new Date("2026-07-01T20:53:49.772Z"),
        toolUseId: new Uuid("toolu_01GkePu7Mj4DmkPivZapZB8z"),
    };
    const firstChangeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/core_inventory.py"));
    const secondChangeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/reports.py"));
    assert.notEqual(firstChangeId.toString(), secondChangeId.toString());
});

test("test_computeScriptExecutionChangeId_embeds_tool_use_id", () => {
    // The source segment is the tool_use id, so attribution can unwrap it back to a known block.
    const run: ScriptRun = {
        code: "python3 apply_renames.py",
        timestamp: new Date("2026-07-01T20:53:49.772Z"),
        toolUseId: new Uuid("toolu_01GkePu7Mj4DmkPivZapZB8z"),
    };
    const changeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/core_inventory.py"));
    assert.equal(changeId.toString(), "scriptRun:toolu_01GkePu7Mj4DmkPivZapZB8z:/tmp/demo/core_inventory.py");
});

test("test_computeScriptExecutionChangeId_falls_back_to_timestamp_without_tool_use_id", () => {
    // A run no tool_use produced falls back to its epoch-ms timestamp, which never contains ":".
    const timestamp = new Date("2026-07-01T20:53:49.772Z");
    const run: ScriptRun = { code: "python3 apply_renames.py", timestamp };
    const changeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/core_inventory.py"));
    assert.equal(changeId.toString(), `scriptRun:${timestamp.getTime()}:/tmp/demo/core_inventory.py`);
});

test("test_getScriptRunSourceIdFromChangeId_extracts_source_segment", () => {
    assert.equal(getScriptRunSourceIdFromChangeId("scriptRun:toolu_abc:/a/b.py"), "toolu_abc");
});

test("test_getScriptRunSourceIdFromChangeId_returns_undefined_for_other_ids", () => {
    // Record uuids and originalFile: seed ids must pass through the resolver untouched.
    assert.equal(getScriptRunSourceIdFromChangeId("0b7f2b4c-1234-4abc-8def-0123456789ab"), undefined);
    assert.equal(getScriptRunSourceIdFromChangeId("originalFile:toolu_x"), undefined);
});
