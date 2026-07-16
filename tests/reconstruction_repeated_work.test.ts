// Tests that deterministic reconstruction work is never repeated: a script run executes once
// (not once per nested lineage replay), and a file's lineage seed is replayed once per
// (target, before) instant (not once per Write event that requests it). Root causes and log
// evidence: ~/.claude/plans/2026-07-07-reveng-repeated-reconstruction-work.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructFilesOver } from "../src/reconstruction_renderable.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

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

// Every progress label reported while `work` runs; the sink is always restored afterwards so
// no other test observes this one's instrumentation.
function collectProgressLabels(work: () => void): string[] {
    const labels: string[] = [];
    setReconstructionProgressSink((event) => {
        labels.push(event.label);
    });
    try {
        work();
    } finally {
        setReconstructionProgressSink(undefined);
    }
    return labels;
}

// A python run that rewrites each named file in place, so the run provably touches them all.
function buildRewriteScript(filenames: string[]): string {
    const nameList = filenames.map((filename) => `"${filename}"`).join(", ");
    return `for name in [${nameList}]:\n`
        + "    text = open(name).read()\n"
        + '    open(name, "w").write(text.replace("old", "new"))\n';
}

// Three written files and one script run that rewrites all of them, in chronological order.
function buildThreeFileOneRunRecords(): TranscriptRecord[] {
    return [
        buildToolRecord(ToolName.Write, { file_path: "/proj/alpha.py", content: "alpha = 'old'\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/beta.py", content: "beta = 'old'\n" }, "2026-01-01T00:00:02Z"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/gamma.py", content: "gamma = 'old'\n" }, "2026-01-01T00:00:03Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: buildRewriteScript(["alpha.py", "beta.py", "gamma.py"]) },
            "2026-01-01T00:00:04Z",
        ),
    ];
}

// Like buildThreeFileOneRunRecords, but alpha.py is written TWICE before the run — so the run's
// pre-execution state requests alpha's lineage once per Write event.
function buildTwiceWrittenFileRecords(): TranscriptRecord[] {
    return [
        buildToolRecord(ToolName.Write, { file_path: "/proj/alpha.py", content: "alpha = 'old'\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.Write, { file_path: "/proj/alpha.py", content: "alpha = 'old'\nextra = 'old'\n" }, "2026-01-01T00:00:02Z"),
        buildToolRecord(
            ToolName.CtxExecute,
            { cwd: "/proj", code: buildRewriteScript(["alpha.py"]) },
            "2026-01-01T00:00:03Z",
        ),
    ];
}

test("test_lineage_of_a_twice_written_file_replays_once_per_prestate", () => {
    // Scenario: getPreExecutionState requests alpha.py's lineage once per Write event of that
    // file; the replay is deterministic for (records, target, before) and must be cached, not
    // recomputed per request.
    // Steps:
    // reconstruct all files over records holding 2 Writes of alpha.py and 1 run rewriting it.
    const labels = collectProgressLabels(() => {
        reconstructFilesOver(buildTwiceWrittenFileRecords(), emptyReader);
    });
    // assert alpha.py's lineage was replayed exactly once.
    const alphaReplays = labels.filter((label) => label === "replaying lineage of /proj/alpha.py");
    assert.equal(alphaReplays.length, 1);
});

test("test_reconstructFilesOver_executes_each_script_run_exactly_once", () => {
    // Scenario: one script run seeding 3 files must execute once, not once per nested lineage
    // replay — building the run's pre-execution state replays each seeded file's lineage, and
    // each replay's script stage must not re-enter the same still-in-flight execution.
    // Steps:
    // reconstruct all files over records holding 3 Writes and 1 run that rewrites all 3.
    const labels = collectProgressLabels(() => {
        reconstructFilesOver(buildThreeFileOneRunRecords(), emptyReader);
    });
    // assert the run was executed exactly once.
    const executions = labels.filter((label) => label.startsWith("executing script run @"));
    assert.equal(executions.length, 1);
});

// Five written files and two script runs that each rewrite all of them — the logs3.txt duplicate
// pattern (32 replays of one file, 20 executions of one run) in miniature.
const FIVE_FILENAMES = ["alpha.py", "beta.py", "gamma.py", "delta.py", "epsilon.py"];

function buildFiveFileTwoRunRecords(): TranscriptRecord[] {
    const writes = FIVE_FILENAMES.map((filename, index) =>
        buildToolRecord(
            ToolName.Write,
            { file_path: `/proj/${filename}`, content: `value = 'old ${filename}'\n` },
            `2026-01-01T00:00:0${index + 1}Z`,
        ),
    );
    return [
        ...writes,
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: buildRewriteScript(FIVE_FILENAMES) }, "2026-01-01T00:00:07Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: buildRewriteScript(FIVE_FILENAMES) + "# second pass\n" }, "2026-01-01T00:00:08Z"),
    ];
}

test("test_five_files_two_runs_execute_twice_and_replay_each_lineage_once_per_run", () => {
    // Scenario: with 5 seeded files and 2 runs, the engine must execute each run once (2 total)
    // and replay each file's lineage once per run instant (2 per file) — not the quadratic
    // cascade the duplicate-log audit observed.
    // Steps:
    // reconstruct all files over 5 Writes + 2 rewrite-everything runs.
    const labels = collectProgressLabels(() => {
        reconstructFilesOver(buildFiveFileTwoRunRecords(), emptyReader);
    });
    // assert each run executed exactly once.
    const executions = labels.filter((label) => label.startsWith("executing script run @"));
    assert.equal(executions.length, 2);
    // assert each file's lineage replayed at most once per run instant.
    for (const filename of FIVE_FILENAMES) {
        const replays = labels.filter((label) => label === `replaying lineage of /proj/${filename}`);
        assert.ok(replays.length <= 2, `${filename} replayed ${replays.length} times (max 2)`);
    }
});

