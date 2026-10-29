import { test } from "node:test";
import assert from "node:assert/strict";
import { formatScriptStageLabel, applyScriptExecutions } from "../src/reconstruction_script_stage.ts";
import {
    findScriptCreatedPaths,
    executeRunOnce,
    PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX,
} from "../src/reconstruction_script_runs.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import { PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX } from "../src/reconstruction_script_sandbox.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

// The findRunForTarget glob test lives in tests/reconstruction_script_probe.test.ts.

test("test_findScriptCreatedPaths_returns_files_that_exist_only_after_a_run", () => {
    // "out.txt" is never Written or Edited elsewhere, so only the run can account for it.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const created = findScriptCreatedPaths(records, emptyReader);
    assert.deepEqual(created.map((path) => path.toString()), ["/proj/out.txt"]);
});

test("test_beaconlessScriptExecution_injects_a_birth_for_a_script_created_file", () => {
    // out.txt has no prior events, so the injected birth is its only one.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const events = applyScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.scriptExecution);
    assert.equal((events[0] as { content: string }).content, "created\n");
});

test("test_beaconlessScriptExecution_chains_a_later_run_over_a_script_created_file", () => {
    // The chained gate must inject both the birth and the rewrite.
    const moveScript = 'import shutil\nshutil.move("one.py", "core_one.py")\n';
    const renameScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
        + '    text = open(p).read()\n'
        + '    open(p, "w").write(text.replace("f_one", "alpha"))\n';
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/one.py", content: "def f_one(x):\n    return x + 1\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: moveScript }, "2026-01-01T00:00:02Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: renameScript }, "2026-01-01T00:00:03Z"),
    ];
    const events = applyScriptExecutions(records, [], emptyReader, new Path("/proj/core_one.py"));
    assert.equal(events.length, 2);
    assert.ok((events[0] as { content: string }).content.includes("def f_one(x):"));
    assert.ok((events[1] as { content: string }).content.includes("def alpha(x):"));
});

test("test_applyScriptExecutions_stamps_the_same_changeId_across_replays", () => {
    // Both replays must stamp the same changeId so their events join.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const firstReplayEvents = applyScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    const secondReplayEvents = applyScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    assert.equal(firstReplayEvents.length, 1);
    assert.equal(secondReplayEvents.length, 1);
    assert.equal(firstReplayEvents[0]!.kind, EventKind.scriptExecution);
    assert.equal(firstReplayEvents[0]!.changeId.toString(), secondReplayEvents[0]!.changeId.toString());
});

test("test_executeRunOnce_skips_the_sandbox_for_a_read_only_script", () => {
    // An analysis run with no write primitive must not spawn a sandbox; it memoizes as empty pre, undefined post.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/ledger.py", content: "def add(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'print(len(open("ledger.py").read()))\n' }, "2026-01-01T00:00:02Z"),
    ];
    const run = findScriptExecutionRuns(records)[0]!;
    const spawnLabels: string[] = [];
    const skipLabels: string[] = [];
    setReconstructionProgressSink((event) => {
        if (event.label.startsWith(PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX)) spawnLabels.push(event.label);
        if (event.label.startsWith(PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX)) skipLabels.push(event.label);
    });
    try {
        const execution = executeRunOnce(run, records, emptyReader);
        assert.equal(execution.post, undefined);
        assert.equal(spawnLabels.length, 0);
        assert.equal(skipLabels.length, 1);
    } finally {
        setReconstructionProgressSink(undefined);
    }
});


// Task 191 follow-up: the label shows the windowed count against the total pool, so a watcher sees replay progress.
test("test_script_stage_label_shows_windowed_count_of_total", () => {
    assert.equal(
        formatScriptStageLabel(3, 10, new Path("/tmp/x.py")),
        "script stage: 3 of 10 runs for /tmp/x.py",
    );
    assert.equal(formatScriptStageLabel(3, 10, undefined), "script stage: 3 of 10 runs");
});
