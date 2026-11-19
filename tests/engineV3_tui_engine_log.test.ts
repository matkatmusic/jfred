import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome, PlayOutcomeKind, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { StepResultLine } from "../engineV3/engineV3_step_start_at.ts";
import type { StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { getProjectCacheFile } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { ENGINE_LOG_MEMORY_LINE_COUNT, EngineLogLineKind, createEngineLog, describePlaySummary, describeStepSummary, getEngineLogFile } from "../engineV3/tui/engineV3_tui_engine_log.ts";

const NOW = new Date(2026, 5, 27, 8, 41, 2, 7);
const START_AT = new Date("2026-06-27T02:41:08.000Z");
const GEO_CORE = new Path("geo_core.py");
const TEST_GEO_CORE = new Path("tests/test_geo_core.py");

function makeLogFile(): Path {
    return new Path(join(mkdtempSync(join(tmpdir(), "engine-log-")), "nested", "engine.log"));
}

function makeStepRequest(file: Path): StepRequest {
    return { file, startAt: START_AT, isPassingStops: false };
}

function makeResultLine(outcome: InverseStepOutcome, commitsWritten: number): StepResultLine {
    return { startAt: START_AT.toISOString(), outcome, commitsWritten, position: 154, commit: "f2023158abcdef", eventType: null, source: null };
}

test("test_raw_and_summary_lines_are_listed_in_the_order_they_were_appended", () => {
    // Scenario: one raw line then one summary line are appended.
    const engineLog = createEngineLog(makeLogFile(), () => NOW);
    // append a raw line for geo_core.py.
    engineLog.appendRawLine(GEO_CORE, '{"outcome":"start-at-reached"}');
    // append a summary line.
    engineLog.appendSummaryLine("walk  geo_core.py");
    // the list holds the raw line first, then the summary line, each led by the clock with milliseconds.
    assert.deepEqual(engineLog.listLines(), [
        { kind: EngineLogLineKind.Raw, text: '08:41:02.007 [geo_core.py] {"outcome":"start-at-reached"}' },
        { kind: EngineLogLineKind.Summary, text: "08:41:02.007 walk  geo_core.py" },
    ]);
});

test("test_each_appended_line_is_written_to_the_file_with_its_kind_letter", () => {
    // Scenario: a raw line and a summary line are appended to a log whose folder does not exist yet.
    const logFile = makeLogFile();
    const engineLog = createEngineLog(logFile, () => NOW);
    engineLog.appendRawLine(GEO_CORE, "hello");
    engineLog.appendSummaryLine("done");
    // the file holds "R " + the clock + the raw text, then "S " + the clock + the summary text, one per line.
    assert.equal(readFileSync(logFile.toString(), "utf8"), "R 08:41:02.007 [geo_core.py] hello\nS 08:41:02.007 done\n");
});

test("test_the_memory_list_keeps_only_the_newest_lines_but_the_file_keeps_all", () => {
    // Scenario: three more lines than the memory limit are appended.
    const logFile = makeLogFile();
    const engineLog = createEngineLog(logFile, () => NOW);
    const appendedCount = ENGINE_LOG_MEMORY_LINE_COUNT + 3;
    for (let index = 0; index < appendedCount; index++) {
        engineLog.appendSummaryLine(`line ${index}`);
    }
    // the list holds the memory limit of lines, the oldest kept line is line 3.
    const lines = engineLog.listLines();
    assert.equal(lines.length, ENGINE_LOG_MEMORY_LINE_COUNT);
    assert.equal(lines[0]!.text, "08:41:02.007 line 3");
    assert.equal(lines[lines.length - 1]!.text, `08:41:02.007 line ${appendedCount - 1}`);
    // the file holds every line.
    assert.equal(readFileSync(logFile.toString(), "utf8").split("\n").length - 1, appendedCount);
});

test("test_the_log_file_is_engine_log_in_the_cache_folder_of_the_store", () => {
    // Scenario: the log file sits next to the project cache file of the same store.
    const storeFolder = new Path("/somewhere/my-store");
    // the log file is engine.log in the folder of the project cache file.
    assert.equal(getEngineLogFile(storeFolder).toString(), join(dirname(getProjectCacheFile(storeFolder).toString()), "engine.log"));
});

test("test_a_covered_step_summary_names_the_target_time_and_the_added_commits", () => {
    // Scenario: a walk reached its start time and wrote 3 commits.
    const outcome = { kind: StepProcessOutcomeKind.Covered as const, lastLine: makeResultLine(InverseStepOutcome.StartAtReached, 3) };
    // the line reads time, walk, file, arrow, target time, commit count.
    assert.equal(describeStepSummary(makeStepRequest(GEO_CORE), outcome), "walk  geo_core.py -> 2026-06-27T02:41:08Z  3 commits added");
});

test("test_a_finished_step_summary_says_there_is_no_older_change", () => {
    // Scenario: a walk found no older change.
    const outcome = { kind: StepProcessOutcomeKind.Finished as const, lastLine: makeResultLine(InverseStepOutcome.NoOlderChange, 0) };
    assert.equal(describeStepSummary(makeStepRequest(GEO_CORE), outcome), "walk  geo_core.py  finished (no older change)");
});

test("test_a_stopped_step_summary_names_the_event_type_the_commit_and_the_position", () => {
    // Scenario: a walk stopped at a script that may write.
    const lastLine = { ...makeResultLine(InverseStepOutcome.UnknownOrRoadblock, 0), eventType: FileEventType.ScriptMayWrite };
    const outcome = { kind: StepProcessOutcomeKind.Stopped as const, eventType: FileEventType.ScriptMayWrite, source: null, lastLine };
    // the commit shows its first 8 letters, then a colon, then the position.
    assert.equal(describeStepSummary(makeStepRequest(TEST_GEO_CORE), outcome), "walk  tests/test_geo_core.py  stopped at ScriptMayWrite (f2023158:154)");
});

test("test_a_crashed_step_summary_says_crashed_and_holds_the_error_on_one_line", () => {
    // Scenario: a walk process exited with code 1 and two error lines.
    const outcome = { kind: StepProcessOutcomeKind.Crashed as const, exitCode: 1, signal: null, crashedAt: null, stderrTail: "Error: boom\n  at line 5" };
    // the line starts with CRASHED, names the exit code, and holds both error lines without a newline.
    const summary = describeStepSummary(makeStepRequest(new Path("rename_geo.py")), outcome);
    assert.equal(summary, "walk  rename_geo.py  CRASHED process exited with code 1: Error: boom   at line 5");
    assert.ok(!summary.includes("\n"));
});

test("test_a_replayed_play_summary_says_replayed", () => {
    // Scenario: a play replayed.
    assert.equal(describePlaySummary(TEST_GEO_CORE, { kind: PlayOutcomeKind.Replayed, reasonText: undefined }), "play  tests/test_geo_core.py  replayed");
});

test("test_a_refused_play_summary_holds_the_reason", () => {
    // Scenario: a play was refused with a reason.
    assert.equal(describePlaySummary(TEST_GEO_CORE, { kind: PlayOutcomeKind.ReplayRefused, reasonText: "disk differs" }), "play  tests/test_geo_core.py  replay refused: disk differs");
});

test("test_a_crashed_play_summary_says_crashed_and_holds_the_reason", () => {
    // Scenario: a play process crashed.
    assert.equal(describePlaySummary(TEST_GEO_CORE, { kind: PlayOutcomeKind.Crashed, reasonText: "boom" }), "play  tests/test_geo_core.py  CRASHED: boom");
});
