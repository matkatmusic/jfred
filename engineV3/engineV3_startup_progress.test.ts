import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { runStartupPhase, type ReportPhaseProgress } from "./engineV3_startup_progress.ts";
import { createScriptReplayContext, loadReplayJSONLLines } from "./engineV3_replay.ts";
import { readReplaySettingsFromArguments } from "./engineV3_replay_settings.ts";
import { getNextEvent } from "./engineV3_replay_timeline.ts";

const START_MILLISECONDS = Date.UTC(2026, 10, 10, 22, 0, 0);
const ISO_TIME_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";

// A clock the test moves by hand, so no test sleeps.
type FakeClock = { readNow: () => Date; advanceSeconds: (seconds: number) => void };

function createFakeClock(): FakeClock {
    let nowMilliseconds = START_MILLISECONDS;
    return {
        readNow: () => new Date(nowMilliseconds),
        advanceSeconds: (seconds: number) => {
            nowMilliseconds += seconds * 1000;
        },
    };
}

// A phase of itemCount items where each item takes secondsPerItem on the fake clock.
function runItemsPhase(clock: FakeClock, itemCount: number, secondsPerItem: number, reportProgress: ReportPhaseProgress): number {
    for (let doneCount = 1; doneCount <= itemCount; doneCount++) {
        clock.advanceSeconds(secondsPerItem);
        reportProgress(doneCount, itemCount);
    }
    return itemCount;
}

function listProgressLines(printedLines: string[], phaseName: string): string[] {
    const progressPattern = new RegExp(`^${ISO_TIME_PATTERN} startup: ${phaseName} \\d+/\\d+$`);
    return printedLines.filter((line) => progressPattern.test(line));
}

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-startup-progress-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// One Bash call and its result, so every collect step has a line to read.
function writeOneBashCallJSONL(folder: string): void {
    const callLine = JSON.stringify({ type: "assistant", uuid: "a1", parentUuid: null, sessionId: "s1", timestamp: "2026-01-01T00:00:10.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "true" } }] } });
    const resultLine = JSON.stringify({ type: "user", uuid: "u1", parentUuid: "a1", sessionId: "s1", timestamp: "2026-01-01T00:00:11.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "" }] } });
    writeFileSync(join(folder, "s1.jsonl"), `${callLine}\n${resultLine}\n`);
}

function readSettingsForFolder(jsonlFolder: string): ReturnType<typeof readReplaySettingsFromArguments> {
    return readReplaySettingsFromArguments(["--state", "/state", "--touched-out", "/touched.txt", "--mac-plate", "/plate", "--jot", "/jot", "--jsonl", jsonlFolder]);
}

test("test_runStartupPhase_prints_one_line_with_the_description_and_the_seconds", () => {
    // Scenario: a phase that takes 41 seconds prints "<ISO time> startup: <description> in 41s" when it ends.
    const clock = createFakeClock();
    const printedLines: string[] = [];
    const result = runStartupPhase("JSONL load", () => {
        clock.advanceSeconds(41);
        return 3;
    }, (lineCount) => `loaded 2 JSONL files, ${lineCount} lines`, clock.readNow, (line) => printedLines.push(line));
    // The phase result is handed back unchanged.
    assert.equal(result, 3);
    // The one line holds the end time, the description and the whole seconds.
    assert.deepEqual(printedLines, ["2026-11-10T22:00:41.000Z startup: loaded 2 JSONL files, 3 lines in 41s"]);
});

test("test_runStartupPhase_prints_progress_lines_for_a_phase_over_ten_seconds", () => {
    // Scenario: 30 items of 1 second each take 30 seconds, so a progress line prints at 10, 20 and 30 seconds.
    const clock = createFakeClock();
    const printedLines: string[] = [];
    runStartupPhase("JSONL load", (reportProgress) => runItemsPhase(clock, 30, 1, reportProgress), (itemCount) => `loaded ${itemCount} items`, clock.readNow, (line) => printedLines.push(line));
    // Three progress lines, each with the done count and the total.
    assert.deepEqual(listProgressLines(printedLines, "JSONL load"), [
        "2026-11-10T22:00:10.000Z startup: JSONL load 10/30",
        "2026-11-10T22:00:20.000Z startup: JSONL load 20/30",
        "2026-11-10T22:00:30.000Z startup: JSONL load 30/30",
    ]);
});

test("test_runStartupPhase_prints_no_progress_line_for_a_fast_phase", () => {
    // Scenario: 30 items of 0.1 second each take 3 seconds, so no progress line prints, only the end line.
    const clock = createFakeClock();
    const printedLines: string[] = [];
    runStartupPhase("JSONL load", (reportProgress) => runItemsPhase(clock, 30, 0.1, reportProgress), (itemCount) => `loaded ${itemCount} items`, clock.readNow, (line) => printedLines.push(line));
    assert.deepEqual(listProgressLines(printedLines, "JSONL load"), []);
    assert.equal(printedLines.length, 1);
});

test("test_loadReplayJSONLLines_prints_the_JSONL_load_line_with_files_and_lines", (t) => {
    // Scenario: one JSONL file with 2 lines prints "loaded 1 JSONL files, 2 lines in <N>s".
    const folder = makeTempFolder(t);
    writeOneBashCallJSONL(folder);
    const printedLines: string[] = [];
    t.mock.method(console, "log", (line: string) => printedLines.push(line));
    loadReplayJSONLLines(readSettingsForFolder(folder));
    assert.equal(printedLines.filter((line) => new RegExp(`^${ISO_TIME_PATTERN} startup: loaded 1 JSONL files, 2 lines in \\d+s$`).test(line)).length, 1);
});

test("test_createScriptReplayContext_prints_one_line_per_collect_step", (t) => {
    // Scenario: each of the five collect steps prints its name and the number of entries it returned.
    const folder = makeTempFolder(t);
    writeOneBashCallJSONL(folder);
    const settings = readSettingsForFolder(folder);
    const printedLines: string[] = [];
    t.mock.method(console, "log", (line: string) => printedLines.push(line));
    createScriptReplayContext(settings, loadReplayJSONLLines(settings));
    for (const stepName of ["collectBashCallResults", "collectWriteEditResultLines", "collectForkedMessageIds", "collectEarlierSiblingMessageIds", "collectResultTurnSnapshotIds"]) {
        const stepPattern = new RegExp(`^${ISO_TIME_PATTERN} startup: ${stepName} returned \\d+ entries in \\d+s$`);
        assert.equal(printedLines.filter((line) => stepPattern.test(line)).length, 1, `one line for ${stepName}`);
    }
});

test("test_getNextEvent_prints_one_line_per_timeline_build_phase", (t) => {
    // Scenario: the first getNextEvent builds the timeline and prints one line each for the outside-git events, plate events, line events and the merge.
    const folder = makeTempFolder(t);
    writeOneBashCallJSONL(folder);
    const printedLines: string[] = [];
    t.mock.method(console, "log", (line: string) => printedLines.push(line));
    getNextEvent(undefined, [new Path(folder)], null, undefined);
    for (const phasePattern of ["built 0 outside-git events", "merged 0 plate events into 0 outside-git events", "built 2 line events", "merged the timeline: 2 events"]) {
        const linePattern = new RegExp(`^${ISO_TIME_PATTERN} startup: ${phasePattern} in \\d+s$`);
        assert.equal(printedLines.filter((line) => linePattern.test(line)).length, 1, `one line for ${phasePattern}`);
    }
});
