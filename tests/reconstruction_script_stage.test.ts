import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructAll } from "../src/reconstruction_engine.ts";
import { linesTextOf } from "../src/reconstruction_revisions.ts";
import { formatScriptStageLabel, injectScriptExecutions } from "../src/reconstruction_script_stage.ts";
import {
    discoverScriptCreatedPaths,
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
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { jsonlPathsForScenario } from "./fixtures.ts";

function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

// test_runForTarget_matches_a_run_that_touches_the_target_without_naming_it: moved to tests/reconstruction_script_probe.test.ts (task 192 — runForTarget's new module home).

const COMMENT = "# names normalized via rename script";

function reconstructLedger() {
    // Task 165: the reader needs each record's on-disk source to find sidecars; source-less records fall back to live file-history.
    const records = jsonlPathsForScenario("s37").flatMap((path) => loadTranscript(path.toString()).records);
    const reader = buildSidecarReader(records)!;
    const histories = reconstructAll(records, reader);
    const ledger = histories.find(
        (history) =>
            history.target.toString().endsWith("/ledger.py") &&
            !history.target.toString().endsWith("test_ledger.py"),
    );
    assert.ok(ledger !== undefined, "ledger.py history present");
    return ledger;
}

test("test_discoverScriptCreatedPaths_returns_files_that_exist_only_after_a_run", () => {
    // "out.txt" is never Written or Edited elsewhere, so only the run can account for it.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const created = discoverScriptCreatedPaths(records, emptyReader);
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
    const events = injectScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.scriptExecution);
    assert.equal((events[0] as { content: string }).content, "created\n");
});

test("test_beaconlessScriptExecution_chains_a_later_run_over_a_script_created_file", () => {
    // The chained gate must inject both the birth and the rewrite, though run 2's sandbox never held the script-born file.
    const moveScript = 'import shutil\nshutil.move("one.py", "core_one.py")\n';
    const renameScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
        + '    text = open(p).read()\n'
        + '    open(p, "w").write(text.replace("f_one", "alpha"))\n';
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/one.py", content: "def f_one(x):\n    return x + 1\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: moveScript }, "2026-01-01T00:00:02Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: renameScript }, "2026-01-01T00:00:03Z"),
    ];
    const events = injectScriptExecutions(records, [], emptyReader, new Path("/proj/core_one.py"));
    assert.equal(events.length, 2);
    assert.ok((events[0] as { content: string }).content.includes("def f_one(x):"));
    assert.ok((events[1] as { content: string }).content.includes("def alpha(x):"));
});

// C5c/C7 — the engine computes post-script content rather than splicing a backup, so renames apply but stray comments do not.
test("test_s37_ledger_has_a_script_execution_revision_renamed_without_the_comment", () => {
    const ledger = reconstructLedger();
    const scriptRev = ledger.revisions.find(
        (revision) => revision.kind === EventKind.scriptExecution,
    );
    assert.ok(scriptRev !== undefined, "a script-execution revision exists");
    const text = linesTextOf(scriptRev).join("\n");
    assert.ok(text.includes("def record_entry("), "applied add_entry -> record_entry");
    assert.ok(text.includes("def total_debits("), "applied tot_debits -> total_debits");
    assert.ok(!text.includes("add_entry"), "no pre-rename name survives");
    assert.ok(!text.includes(COMMENT), "the out-of-band comment is not in the post-script revision");
});

test("test_injectScriptExecutions_stamps_the_same_changeId_across_replays", () => {
    // Both replays call the stage independently, so the synthetic event must carry the same changeId or their events never join.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const firstReplayEvents = injectScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    const secondReplayEvents = injectScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
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
