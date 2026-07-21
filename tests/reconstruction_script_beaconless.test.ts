// Per-file tests for src/reconstruction_script_beaconless.ts (task 122): the birth gate, the
// item-68 read-only bail, and run chaining through the target's rolling content — exercising
// beaconlessScriptExecutions directly (the injectScriptExecutions wrapper is covered by
// reconstruction_script_stage.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { beaconlessScriptExecutions } from "../src/reconstruction_script_beaconless.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// A synthetic assistant record carrying one tool_use of `name` with `input`, at `timestamp`.
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

test("test_beaconlessScriptExecutions_injects_a_birth_for_a_script_written_target", () => {
    // Steps:
    // records: a Write of the script file, then a run whose script births out.txt.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' }, "2026-01-01T00:00:02Z"),
    ];
    const runs = findScriptExecutionRuns(records);
    // run the beaconless gate directly for the script-born target.
    const events = beaconlessScriptExecutions(new Path("/proj/out.txt"), runs, records, emptyReader);
    // assert one scriptExecution event carrying the created content at the run's timestamp.
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.scriptExecution);
    assert.equal(events[0]!.content, "created\n");
    assert.equal(events[0]!.timestamp.getTime(), new Date("2026-01-01T00:00:02Z").getTime());
});

test("test_beaconlessScriptExecutions_returns_no_event_for_a_read_only_run", () => {
    // Steps:
    // records: a Write plus a read-only counting script over it (no write primitive).
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/ledger.py", content: "def add(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'print(len(open("ledger.py").read()))\n' }, "2026-01-01T00:00:02Z"),
    ];
    const runs = findScriptExecutionRuns(records);
    // the item-68 gate bails before any sandbox work: no event for the read-only run.
    const events = beaconlessScriptExecutions(new Path("/proj/ledger.py"), runs, records, emptyReader);
    assert.equal(events.length, 0);
});

test("test_beaconlessScriptExecutions_chains_a_later_run_over_the_rolling_content", () => {
    // Scenario: run 1 births core_one.py via shutil.move; run 2 glob-renames f_one -> alpha.
    // The chained gate must yield BOTH events even though run 2 never names the born file —
    // run 2 executes against run 1's rolling output, not its own cached pre-state.
    const moveScript = 'import shutil\nshutil.move("one.py", "core_one.py")\n';
    const renameScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
        + '    text = open(p).read()\n'
        + '    open(p, "w").write(text.replace("f_one", "alpha"))\n';
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/one.py", content: "def f_one(x):\n    return x + 1\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: moveScript }, "2026-01-01T00:00:02Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: renameScript }, "2026-01-01T00:00:03Z"),
    ];
    const runs = findScriptExecutionRuns(records);
    const events = beaconlessScriptExecutions(new Path("/proj/core_one.py"), runs, records, emptyReader);
    // assert the birth then the rename applied over the birth content.
    assert.equal(events.length, 2);
    assert.ok(events[0]!.content.includes("def f_one(x):"));
    assert.ok(events[1]!.content.includes("def alpha(x):"));
});
