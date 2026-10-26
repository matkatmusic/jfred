import { test } from "node:test";
import assert from "node:assert/strict";
import {
    findScriptExecutionRuns,
    isScriptExecutionRun,
} from "../src/reconstruction_script_execution.ts";
import { replayEvents } from "../src/reconstruction_replay.ts";
import { linesTextOf } from "../src/reconstruction_revisions.ts";
import { BlockType, EventKind, ToolName } from "../src/structures/vocabulary.ts";
import type { ToolUseBlock } from "../src/structures/content-blocks.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

function toolUse(name: ToolName, input: Record<string, unknown>): ToolUseBlock {
    return { type: BlockType.tool_use, id: new Uuid("toolu_x"), name, input } as unknown as ToolUseBlock;
}

// C6b — a scriptExecution event replays wholesale, like an overwrite: one full-content revision of its precomputed post-script content.
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
    const records = [buildToolRecord(ToolName.Bash, { command: "python3 -c 'print(1)'" }, "2026-01-01T00:00:01Z", "/tmp/proj")];
    const runs = findScriptExecutionRuns(records);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.cwd?.toString(), "/tmp/proj");
});

test("test_findScriptExecutionRuns_resolves_indirection_to_the_body_current_at_each_run_instant", () => {
    // A script rewritten between runs must resolve to the body current at that instant, not the last Write loaded.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/w/apply.py", content: "print('v1')\n" }, "2026-01-01T00:00:01Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:02Z", "/w"),
        buildToolRecord(ToolName.Write, { file_path: "/w/apply.py", content: "print('v2')\n" }, "2026-01-01T00:00:03Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:04Z", "/w"),
    ];
    const runs = findScriptExecutionRuns(records);
    assert.equal(runs.length, 2);
    assert.equal(runs[0]!.code, "print('v1')\n");
    assert.equal(runs[1]!.code, "print('v2')\n");
});

test("test_findScriptExecutionRuns_resolves_indirection_time_aware_across_record_order", () => {
    // The EARLIER write arrives LAST, so resolution must be by timestamp and not load order.
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

test("test_findScriptExecutionRuns_resolves_indirection_to_a_write_with_path_and_file_text", () => {
    const records = [
        buildToolRecord(ToolName.Write, { path: "/w/apply.py", file_text: "print('new')\n" }, "2026-01-01T00:00:01Z", "/w"),
        buildToolRecord(ToolName.Bash, { command: "python3 apply.py" }, "2026-01-01T00:00:02Z", "/w"),
    ];
    const runs = findScriptExecutionRuns(records);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.code, "print('new')\n");
});

test("test_findScriptExecutionRuns_carries_the_tool_use_id", () => {
    // A run remembers its tool_use block so the changeId can embed a session-attributable id.
    const records = [buildToolRecord(ToolName.Bash, { command: "python3 apply_renames.py" }, "2026-07-01T20:53:49.772Z")];
    const runs = findScriptExecutionRuns(records);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.toolUseId?.toString(), "toolu_x");
});
