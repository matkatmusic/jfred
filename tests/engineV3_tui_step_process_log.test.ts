// Every output line of a child process goes to the engine log, with the file name in front.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { makeInstant } from "./engineV3_step_test_projects.ts";
import { createEngineLog } from "../engineV3/tui/engineV3_tui_engine_log.ts";
import { runStepChild } from "../engineV3/tui/engineV3_tui_step_process.ts";

const LOG_FILE = new Path("a.txt");
const STDERR_LINE_COUNT = 30;
const STDERR_TAIL_LINE_COUNT = 20;

// The last standard output line of a step child is its result line, a JSON object.
function buildResultLineScript(): string {
    const resultLine = { startAt: makeInstant(0).toISOString(), outcome: InverseStepOutcome.StartAtReached, commitsWritten: 0, position: 0, commit: "abc", eventType: null, source: null };
    return `process.stdout.write(${JSON.stringify(JSON.stringify(resultLine))} + "\\n");`;
}

function makeFolder(t: TestContext): Path {
    const folder = mkdtempSync(join(tmpdir(), "engineV3-tui-step-log-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return new Path(folder);
}

test("test_every_output_line_goes_to_the_log_with_the_file_name_in_front", async (t) => {
    // Scenario: a child writes one line to standard output and two to standard error (the last without a newline).
    const folder = makeFolder(t);
    const file = new Path(join(folder.toString(), "a.txt"));
    const engineLog = createEngineLog(new Path(join(folder.toString(), "engine.log")));
    await runStepChild(process.execPath, ["-e", `process.stdout.write("out1\\n"); process.stderr.write("err1\\nerr2 without newline"); ${buildResultLineScript()}`], folder, file, engineLog, LOG_FILE);
    // the log holds the lines, each with the project-relative file name in front; the last standard error line has no newline.
    const texts = engineLog.listLines().map((line) => line.text);
    assert.ok(texts.includes("[a.txt] out1"));
    assert.ok(texts.includes("[a.txt] err1"));
    assert.ok(texts.includes("[a.txt] err2 without newline"));
});

test("test_a_carriage_return_ends_a_log_line_and_no_log_line_holds_one", async (t) => {
    // Scenario: a child writes progress text that starts each update with a carriage return.
    const folder = makeFolder(t);
    const file = new Path(join(folder.toString(), "a.txt"));
    const engineLog = createEngineLog(new Path(join(folder.toString(), "engine.log")));
    await runStepChild(process.execPath, ["-e", `process.stderr.write("\\rC: 1/1 logs read, 4 files, 5 ms\\rC: 2/2 logs read\\ndone\\r\\n"); ${buildResultLineScript()}`], folder, file, engineLog, LOG_FILE);
    // each update is its own log line (the result line of the child follows), and no log line holds a carriage return.
    const texts = engineLog.listLines().map((line) => line.text);
    assert.deepEqual(texts.slice(0, 3), ["[a.txt] C: 1/1 logs read, 4 files, 5 ms", "[a.txt] C: 2/2 logs read", "[a.txt] done"]);
    assert.ok(texts.every((text) => !text.includes("\r")));
});

test("test_the_log_file_on_disk_holds_the_raw_lines", async (t) => {
    // Scenario: a child writes one line to standard output.
    const folder = makeFolder(t);
    const file = new Path(join(folder.toString(), "a.txt"));
    const logFile = new Path(join(folder.toString(), "engine.log"));
    await runStepChild(process.execPath, ["-e", `console.log("out1"); ${buildResultLineScript()}`], folder, file, createEngineLog(logFile), LOG_FILE);
    // the file holds the raw line.
    assert.ok(readFileSync(logFile.toString(), "utf8").includes("R [a.txt] out1\n"));
});

test("test_the_log_keeps_every_standard_error_line_while_the_outcome_keeps_the_last_twenty", async (t) => {
    // Scenario: a child writes 30 lines to standard error and exits with code 1.
    const folder = makeFolder(t);
    const file = new Path(join(folder.toString(), "a.txt"));
    const engineLog = createEngineLog(new Path(join(folder.toString(), "engine.log")));
    const outcome = await runStepChild(process.execPath, ["-e", `for (let n = 0; n < ${STDERR_LINE_COUNT}; n++) { console.error("e" + n); } process.exit(1);`], folder, file, engineLog, LOG_FILE);
    // the log holds all 30 lines.
    assert.equal(engineLog.listLines().length, STDERR_LINE_COUNT);
    // the outcome holds the last 20 lines.
    assert.ok(outcome.kind === StepProcessOutcomeKind.Crashed);
    assert.equal(outcome.stderrTail.split("\n").length, STDERR_TAIL_LINE_COUNT);
});
