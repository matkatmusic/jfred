import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructAll } from "../src/reconstruction_engine.ts";
import { linesTextOf } from "../src/reconstruction_revisions.ts";
import { injectScriptExecutions } from "../src/reconstruction_script_stage.ts";
import {
    discoverScriptCreatedPaths,
    executeRunOnce,
    runForTarget,
    PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX,
} from "../src/reconstruction_script_runs.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import { PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX } from "../src/reconstruction_script_sandbox.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";
import {
    createSidecarReader,
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { jsonlPathsForScenario, loadRecords } from "./utilities.ts";

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

test("test_runForTarget_matches_a_run_that_touches_the_target_without_naming_it", () => {
    // Scenario: a script renames functions across files found via glob.glob, so the target's
    // basename never appears in the script source; the gate must still match the run because
    // executing it changes the target's content.
    // Steps:
    // build records with a Write of /proj/core_one.py and a Bash run whose script rewrites
    // every core_*.py via glob (no literal "core_one.py" in the source).
    const globScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
        + '    text = open(p).read()\n'
        + '    open(p, "w").write(text.replace("f_one", "alpha"))\n';
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/core_one.py", content: "def f_one(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: globScript }, "2026-01-01T00:00:02Z"),
    ];
    // resolve the run for target /proj/core_one.py.
    const runs = findScriptExecutionRuns(records);
    const run = runForTarget(runs, new Path("/proj/core_one.py"), new Date("2026-01-01T00:00:10Z"), records, emptyReader);
    // assert the run is found.
    assert.ok(run !== undefined);
});

const COMMENT = "# names normalized via rename script";

// The merged s37 records and an on-disk sidecar reader for its session.
function reconstructLedger() {
    const records = jsonlPathsForScenario("s37").flatMap((path) => loadRecords(path.toString()));
    const reader = createSidecarReader(findSessionId(records)!, getDefaultFileHistoryRoot());
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
    // Steps:
    // build records with a run whose script writes "out.txt" (never Written/Edited elsewhere).
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    // discover created paths.
    const created = discoverScriptCreatedPaths(records, emptyReader);
    // assert the list contains the cwd-resolved out.txt and nothing junk.
    assert.deepEqual(created.map((path) => path.toString()), ["/proj/out.txt"]);
});

test("test_beaconlessScriptExecution_injects_a_birth_for_a_script_created_file", () => {
    // Steps:
    // reconstruct out.txt's events over the same records (no prior events for it).
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    const events = injectScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    // assert injectScriptExecutions returns one scriptExecution event carrying the created content.
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, EventKind.scriptExecution);
    assert.equal((events[0] as { content: string }).content, "created\n");
});

test("test_beaconlessScriptExecution_chains_a_later_run_over_a_script_created_file", () => {
    // Scenario: run 1 births core_one.py via shutil.move; run 2 rewrites every core_*.py via glob.
    // The chained gate must inject BOTH effects: the birth, then the rename applied to the birth
    // content — even though run 2's own sandbox never contained the script-born file.
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

// C5c/C7 — the script run is reconstructed as a script-execution revision of ledger.py: the engine
// COMPUTES the post-script content (the validated forward transform) rather than splicing a backup. The
// revision carries every rename (including the two undocumented `tot_*` subs recovered from the run-time
// CSV) and does NOT carry the out-of-band `# names normalized via rename script` comment.
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
    // Scenario: the step-timeline replay and the file-history replay each call the stage
    // independently over the same records; the synthetic event must carry the identical
    // changeId both times so the two replays' events join (TASKS.md item 34).
    // Steps:
    // build records with a run whose script writes "out.txt" (never Written/Edited elsewhere).
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/runit.py", content: "x" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: 'open("out.txt", "w").write("created\\n")\n' },
            "2026-01-01T00:00:02Z",
        ),
    ];
    // inject twice with identical inputs — one call per replay.
    const firstReplayEvents = injectScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    const secondReplayEvents = injectScriptExecutions(records, [], emptyReader, new Path("/proj/out.txt"));
    // assert both replays produced the scriptExecution event.
    assert.equal(firstReplayEvents.length, 1);
    assert.equal(secondReplayEvents.length, 1);
    assert.equal(firstReplayEvents[0]!.kind, EventKind.scriptExecution);
    // assert the changeIds are identical across the two replays.
    assert.equal(firstReplayEvents[0]!.changeId.toString(), secondReplayEvents[0]!.changeId.toString());
});

test("test_executeRunOnce_skips_the_sandbox_for_a_read_only_script", () => {
    // Scenario: a recorded analysis run with no write primitive must not spawn a sandbox —
    // its execution memoizes as { pre: empty, post: undefined } (TASKS.md item 68).
    // Steps:
    // record a Write plus a read-only counting script over it.
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/ledger.py", content: "def add(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: 'print(len(open("ledger.py").read()))\n' }, "2026-01-01T00:00:02Z"),
    ];
    const run = findScriptExecutionRuns(records)[0]!;
    // execute the run while counting sandbox-spawn and read-only-skip announcements.
    const spawnLabels: string[] = [];
    const skipLabels: string[] = [];
    setReconstructionProgressSink((event) => {
        if (event.label.startsWith(PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX)) spawnLabels.push(event.label);
        if (event.label.startsWith(PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX)) skipLabels.push(event.label);
    });
    try {
        const execution = executeRunOnce(run, records, emptyReader);
        // assert the sandbox never spawned, the skip announced itself, and post is undefined.
        assert.equal(execution.post, undefined);
        assert.equal(spawnLabels.length, 0);
        assert.equal(skipLabels.length, 1);
    } finally {
        setReconstructionProgressSink(undefined);
    }
});

