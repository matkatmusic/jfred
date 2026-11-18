// The Engine Console while the viewer loads: the project cache child writes every output line to the engine log, and the loading screen draws that log.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { Path } from "../src/structures/domain.ts";
import { runProjectCacheProcess } from "../engineV3/tui/engineV3_tui_cache_child.ts";
import { createEngineLog, describeLoadStepSummary, EngineLogLineKind, LoadStepPhase, type EngineLog } from "../engineV3/tui/engineV3_tui_engine_log.ts";
import { LoadingScreen } from "../engineV3/tui/engineV3_tui_loading_screen.tsx";
import { waitMilliseconds } from "./engineV3_tui_app_real_harness.ts";

function makeEngineLog(t: TestContext): EngineLog {
    const folder = mkdtempSync(join(tmpdir(), "engineV3-tui-loading-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return createEngineLog(new Path(join(folder, "engine.log")));
}

function runScript(script: string, engineLog: EngineLog, showProgress: (progressText: string) => void = () => {}, onLogChanged: () => void = () => {}): Promise<void> {
    return runProjectCacheProcess(process.execPath, ["-e", script], process.cwd(), { showProgress, engineLog, onLogChanged });
}

test("test_the_load_step_summary_names_the_step_and_the_phase", () => {
    // Scenario: the summary of the start and of the end of the step "project cache" at 13:05:09.
    const now = new Date(2026, 10, 18, 13, 5, 9);
    // the text holds the clock, the step name and the phase.
    assert.equal(describeLoadStepSummary(now, "project cache", LoadStepPhase.Started), "13:05:09 load  project cache  started");
    assert.equal(describeLoadStepSummary(now, "project cache", LoadStepPhase.Ended), "13:05:09 load  project cache  ended");
});

test("test_every_output_line_except_the_json_lines_goes_to_the_log_with_the_short_name", async (t) => {
    // Scenario: a child writes one line and a JSON result line to standard output, and progress updates, a JSON progress line and a last line to standard error.
    const engineLog = makeEngineLog(t);
    await runScript(`process.stdout.write("out1\\n" + JSON.stringify({ cacheFile: "c.json", wasRebuilt: true }) + "\\n"); process.stderr.write("\\rC: 1/2 logs read\\rC: 2/2 logs read\\n" + JSON.stringify({ file: "a.txt", current: 1, total: 2 }) + "\\nD: done\\n");`, engineLog);
    // the raw lines hold the short name in front.
    const rawTexts = engineLog.listLines().filter((line) => line.kind === EngineLogLineKind.Raw).map((line) => line.text);
    assert.deepEqual(rawTexts, ["[project cache] out1", "[project cache] C: 1/2 logs read", "[project cache] C: 2/2 logs read", "[project cache] D: done"]);
});

test("test_a_summary_line_marks_the_start_and_the_end_of_the_loading_step", async (t) => {
    // Scenario: a child writes one line.
    const engineLog = makeEngineLog(t);
    await runScript(`process.stdout.write("out1\\n");`, engineLog);
    // the first line is the start summary and the last line is the end summary.
    const lines = engineLog.listLines();
    assert.equal(lines[0]!.kind, EngineLogLineKind.Summary);
    assert.ok(lines[0]!.text.endsWith("load  project cache  started"));
    assert.equal(lines.at(-1)!.kind, EngineLogLineKind.Summary);
    assert.ok(lines.at(-1)!.text.endsWith("load  project cache  ended"));
});

test("test_the_screen_is_told_about_every_new_log_line", async (t) => {
    // Scenario: a child writes three lines in one chunk. The log gets 3 raw lines plus the start and end summary lines.
    const engineLog = makeEngineLog(t);
    let changeCount = 0;
    await runScript(`process.stdout.write("a\\nb\\nc\\n");`, engineLog, () => {}, () => { changeCount += 1; });
    assert.equal(changeCount, 5);
});

test("test_a_json_progress_line_on_standard_error_still_gives_the_files_done_text", async (t) => {
    // Scenario: a child writes the progress line of the cache child.
    const engineLog = makeEngineLog(t);
    const progressTexts: string[] = [];
    await runScript(`process.stderr.write(JSON.stringify({ file: "a.txt", current: 1, total: 2 }) + "\\n");`, engineLog, (progressText) => progressTexts.push(progressText));
    assert.deepEqual(progressTexts, ["files done 1 of 2"]);
});

function makeFakeEngineLog(texts: string[]): EngineLog {
    return { appendRawLine: () => {}, appendSummaryLine: () => {}, listLines: () => texts.map((text) => ({ kind: EngineLogLineKind.Raw, text })) };
}

test("test_the_loading_screen_shows_the_progress_text_above_the_newest_log_lines", async (t) => {
    // Scenario: 60 log lines and a screen of 20 rows.
    const texts = Array.from({ length: 60 }, (_, index) => `load-line ${index}`);
    const screen = render(createElement(LoadingScreen, { progressText: "files done 3 of 9", engineLog: makeFakeEngineLog(texts), startSize: { terminalRows: 20, terminalColumns: 100 } }));
    t.after(() => screen.unmount());
    await waitMilliseconds(100);
    const frame = screen.lastFrame()!;
    // the progress text shows, the newest line shows, and the oldest line is scrolled out.
    assert.ok(frame.includes("files done 3 of 9"));
    assert.ok(frame.includes("load-line 59"));
    assert.ok(!frame.includes("load-line 0\n"));
    // the progress line is above the console.
    assert.ok(frame.indexOf("files done 3 of 9") < frame.indexOf("load-line 59"));
});

test("test_the_loading_screen_draws_a_line_that_arrives_later", async (t) => {
    // Scenario: the screen is drawn with one line, then the log gets a second line and the screen is drawn again.
    const texts = ["first-line"];
    const engineLog = makeFakeEngineLog(texts);
    const element = createElement(LoadingScreen, { progressText: "files done 0 of ?", engineLog, startSize: { terminalRows: 20, terminalColumns: 100 } });
    const screen = render(element);
    t.after(() => screen.unmount());
    await waitMilliseconds(100);
    assert.ok(!screen.lastFrame()!.includes("second-line"));
    texts.push("second-line");
    screen.rerender(createElement(LoadingScreen, { progressText: "files done 0 of ?", engineLog, startSize: { terminalRows: 20, terminalColumns: 100 } }));
    await waitMilliseconds(100);
    assert.ok(screen.lastFrame()!.includes("second-line"));
});
