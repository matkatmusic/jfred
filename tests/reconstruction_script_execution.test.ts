import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeScriptExecutionChangeId,
    findScriptExecutionRuns,
    resolveScriptRunChangeIdToSourceId,
    isScriptExecutionRun,
    type ScriptRun,
} from "../src/reconstruction_script_execution.ts";
import { replayEvents } from "../src/reconstruction_replay.ts";
import { linesTextOf } from "../src/reconstruction_revisions.ts";
import { BlockType, EventKind, ToolName } from "../src/structures/vocabulary.ts";
import type { ToolUseBlock } from "../src/structures/content-blocks.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { FileEvent } from "../src/reconstruction_engine.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// A synthetic tool_use block of `name` carrying `input` — for the run-detection predicate.
function toolUse(name: ToolName, input: Record<string, unknown>): ToolUseBlock {
    return { type: BlockType.tool_use, id: new Uuid("toolu_x"), name, input } as unknown as ToolUseBlock;
}

// C6b — replaying a scriptExecution event emits one full-content revision (every line genesis) of its
// precomputed post-script content, under the script-execution kind (wholesale, like an overwrite).
test("test_replay_scriptExecution_emits_its_precomputed_content", () => {
    const events: FileEvent[] = [
        {
            kind: EventKind.write,
            changeId: new Uuid("toolu_write"),
            target: new Path("ledger.py"),
            content: "def add_entry():\n    pass",
            timestamp: new Date("2026-06-26T10:27:38.450Z"),
        },
        {
            kind: EventKind.scriptExecution,
            changeId: new Uuid("toolu_run"),
            target: new Path("ledger.py"),
            content: "def record_entry():\n    pass",
            timestamp: new Date("2026-06-26T10:29:53.899Z"),
        },
    ];
    const revisions = replayEvents(events);
    const final = revisions[revisions.length - 1]!;
    assert.equal(final.kind, EventKind.scriptExecution);
    assert.deepEqual(linesTextOf(final), ["def record_entry():", "    pass"]);
});

// C5b — a run is any Bash or MCP-execution tool_use carrying script source; a Read is not a run.
test("test_isScriptExecutionRun_recognizes_executors_and_rejects_a_read", () => {
    assert.ok(isScriptExecutionRun(toolUse(ToolName.CtxExecute, { code: "import re\n" })));
    assert.ok(isScriptExecutionRun(toolUse(ToolName.Bash, { command: "python apply_renames.py" })));
    assert.ok(!isScriptExecutionRun(toolUse(ToolName.Read, { file_path: "/x/ledger.py" })));
});

test("test_findScriptExecutionRuns_carries_the_records_cwd_on_each_run", () => {
    // Scenario: a Bash script run record includes a cwd; the collected ScriptRun exposes it.
    // Steps:
    // build one transcript record whose tool_use is a Bash python3 run and whose record cwd is "/tmp/proj".
    const records = [buildToolRecord(ToolName.Bash, { command: "python3 -c 'print(1)'" }, "2026-01-01T00:00:01Z", "/tmp/proj")];
    // collect the runs with findScriptExecutionRuns.
    const runs = findScriptExecutionRuns(records);
    // assert the single run's cwd equals "/tmp/proj".
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.cwd?.toString(), "/tmp/proj");
});

test("test_findScriptExecutionRuns_resolves_indirection_to_the_body_current_at_each_run_instant", () => {
    // Scenario: a script file is Written, run, REWRITTEN, and run again (s87's apply_renames.py,
    // written 5×). Each `python3 <file>` run must resolve to the body current at ITS instant —
    // never to whichever Write happened to load last in readdir order.
    // Steps:
    // write version 1 of the script, run it, write version 2, run it again.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/w/apply.py", content: "print('v1')\n" }, "2026-01-01T00:00:01Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:02Z", "/w"),
        buildToolRecord(ToolName.Write, { file_path: "/w/apply.py", content: "print('v2')\n" }, "2026-01-01T00:00:03Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:04Z", "/w"),
    ];
    const runs = findScriptExecutionRuns(records);
    // assert both runs resolved, the first to version 1's body and the second to version 2's.
    assert.equal(runs.length, 2);
    assert.equal(runs[0]!.code, "print('v1')\n");
    assert.equal(runs[1]!.code, "print('v2')\n");
});

test("test_findScriptExecutionRuns_resolves_indirection_time_aware_across_record_order", () => {
    // Scenario: the same two-write history, but the records arrive in readdir order with the
    // EARLIER write loaded LAST — resolution must still be by timestamp, not load order.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/w/apply.py", content: "print('v2')\n" }, "2026-01-01T00:00:03Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:04Z", "/w"),
        buildToolRecord(ToolName.Write, { file_path: "/w/apply.py", content: "print('v1')\n" }, "2026-01-01T00:00:01Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:02Z", "/w"),
    ];
    const runs = findScriptExecutionRuns(records);
    const sortedRuns = [...runs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    assert.equal(sortedRuns[0]!.code, "print('v1')\n");
    assert.equal(sortedRuns[1]!.code, "print('v2')\n");
});

// --- item 34: deterministic synthetic changeIds -----------------------------------------------------

test("test_computeScriptExecutionChangeId_is_deterministic_for_same_run_and_target", () => {
    // Scenario: the step-timeline replay and the file-history replay each derive the changeId for
    // the same run+target independently; both derivations must yield the identical value.
    // Steps:
    // a run with a tool_use id and a target path exists.
    const run: ScriptRun = {
        code: "python3 apply_renames.py",
        timestamp: new Date("2026-07-01T20:53:49.772Z"),
        toolUseId: new Uuid("toolu_01GkePu7Mj4DmkPivZapZB8z"),
    };
    const target = new Path("/tmp/demo/core_inventory.py");
    // computing the id twice must yield the identical value.
    const firstChangeId = computeScriptExecutionChangeId(run, target);
    const secondChangeId = computeScriptExecutionChangeId(run, target);
    assert.equal(firstChangeId.toString(), secondChangeId.toString());
});

test("test_computeScriptExecutionChangeId_differs_per_target", () => {
    // Scenario: one run changing two files yields two distinct changeIds, so each file's
    // synthetic event stays individually addressable.
    // Steps:
    // one run, two different targets.
    const run: ScriptRun = {
        code: "python3 apply_renames.py",
        timestamp: new Date("2026-07-01T20:53:49.772Z"),
        toolUseId: new Uuid("toolu_01GkePu7Mj4DmkPivZapZB8z"),
    };
    const firstChangeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/core_inventory.py"));
    const secondChangeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/reports.py"));
    // the two ids must differ.
    assert.notEqual(firstChangeId.toString(), secondChangeId.toString());
});

test("test_computeScriptExecutionChangeId_embeds_tool_use_id", () => {
    // Scenario: the id's source segment is the run's tool_use id, so session attribution can
    // unwrap the id back to a tool_use the session index knows.
    const run: ScriptRun = {
        code: "python3 apply_renames.py",
        timestamp: new Date("2026-07-01T20:53:49.772Z"),
        toolUseId: new Uuid("toolu_01GkePu7Mj4DmkPivZapZB8z"),
    };
    const changeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/core_inventory.py"));
    // the id is the prefix, then the tool_use id, then the target path.
    assert.equal(changeId.toString(), "scriptRun:toolu_01GkePu7Mj4DmkPivZapZB8z:/tmp/demo/core_inventory.py");
});

test("test_computeScriptExecutionChangeId_falls_back_to_timestamp_without_tool_use_id", () => {
    // Scenario: a synthetic run no tool_use produced still gets a deterministic id, derived
    // from its epoch-ms timestamp (which never contains ":").
    const timestamp = new Date("2026-07-01T20:53:49.772Z");
    const run: ScriptRun = { code: "python3 apply_renames.py", timestamp };
    const changeId = computeScriptExecutionChangeId(run, new Path("/tmp/demo/core_inventory.py"));
    assert.equal(changeId.toString(), `scriptRun:${timestamp.getTime()}:/tmp/demo/core_inventory.py`);
});

test("test_resolveScriptRunChangeIdToSourceId_extracts_source_segment", () => {
    // Scenario: unwrapping a scriptRun changeId exposes the tool_use id the session index knows.
    assert.equal(resolveScriptRunChangeIdToSourceId("scriptRun:toolu_abc:/a/b.py"), "toolu_abc");
});

test("test_resolveScriptRunChangeIdToSourceId_returns_undefined_for_other_ids", () => {
    // Scenario: real record uuids and originalFile: seed ids are not scriptRun ids and must
    // pass through the resolver untouched.
    assert.equal(resolveScriptRunChangeIdToSourceId("0b7f2b4c-1234-4abc-8def-0123456789ab"), undefined);
    assert.equal(resolveScriptRunChangeIdToSourceId("originalFile:toolu_x"), undefined);
});

test("test_findScriptExecutionRuns_carries_the_tool_use_id", () => {
    // Scenario: a run parsed from a transcript record remembers which tool_use block produced
    // it, so the synthetic event's changeId can embed a session-attributable id.
    // Steps:
    // one assistant record with a Bash tool_use block.
    const records = [buildToolRecord(ToolName.Bash, { command: "python3 apply_renames.py" }, "2026-07-01T20:53:49.772Z")];
    // find the runs.
    const runs = findScriptExecutionRuns(records);
    // assert the run carries the block's id.
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.toolUseId?.toString(), "toolu_x");
});
