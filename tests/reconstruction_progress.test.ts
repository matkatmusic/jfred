// Task 191: the reconstruction CLI progress surface — --progress/--progress-all route the
// engine's progress events to stderr so stdout stays pure JSON. Split out of
// reconstruction_cli.test.ts (250-line cap); exercises the sink installed by runCli around
// src/reconstruction_progress.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/reconstruction_cli.ts";
import { S1_JSONL } from "./fixtures.ts";

// ── Task 191: CLI progress on stderr, behind --progress/--progress-all ──

// Run `action` with console.log captured; return every line it tried to print.
function captureConsoleLogLines(action: () => void): string[] {
    const capturedLines: string[] = [];
    const originalLog = console.log;
    console.log = (...parts: unknown[]) => { capturedLines.push(parts.join(" ")); };
    try {
        action();
    } finally {
        console.log = originalLog;
    }
    return capturedLines;
}

// Run `action` with process.stderr.write captured; return every chunk written.
function captureStderrLines(action: () => void): string[] {
    const capturedLines: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => { capturedLines.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
        action();
    } finally {
        process.stderr.write = originalWrite;
    }
    return capturedLines;
}

// Task 191: --json output on stdout is pure JSON — the old per-transcript
// "Loading transcript from <path>" console.log line is retired.
test("test_json_stdout_carries_no_loading_lines", () => {
    // Run the CLI in --json mode with console.log captured.
    let out = "";
    const loggedLines = captureConsoleLogLines(() => { out = runCli([S1_JSONL, "--json"]); });
    // The returned stdout payload parses as JSON with no leading noise.
    JSON.parse(out);
    // Nothing was printed to stdout during the run.
    assert.deepEqual(loggedLines.filter((line) => line.includes("Loading transcript")), []);
});

// Task 191: --progress prints the uncounted stage labels to stderr, and filters
// the counted per-record events (one per JSONL line — the 292MB-run spam).
test("test_progress_flag_writes_stage_labels_to_stderr", () => {
    // Run the CLI with --progress and stderr captured.
    const stderrLines = captureStderrLines(() => { runCli([S1_JSONL, "--json", "--progress"]); });
    const joined = stderrLines.join("");
    // Stage labels from the load phase and the new sidecar-reader announcement appear.
    assert.ok(joined.includes("parsing records"));
    assert.ok(joined.includes("building sidecar backup reader"));
    // The sidecar build reports its result, and the previously-silent window between the
    // sidecar reader and the first per-target line is covered by stage labels too.
    assert.ok(joined.includes("sidecar reader ready"));
    assert.ok(joined.includes("finding conversation branches"));
    assert.ok(joined.includes("extracting file events"));
    // No counted per-item event leaks through at stage level.
    assert.deepEqual(stderrLines.filter((line) => /\(\d+\/\d+\)\n$/.test(line)), []);
});

// Task 191: --progress-all keeps the counted per-record events, formatted "<label> (<i>/<n>)".
test("test_progress_all_flag_writes_counted_record_events", () => {
    // Run the CLI with --progress-all and stderr captured.
    const stderrLines = captureStderrLines(() => { runCli([S1_JSONL, "--json", "--progress-all"]); });
    // At least one counted per-record event was written.
    assert.ok(stderrLines.some((line) => /\(\d+\/\d+\)\n$/.test(line)));
});

// Task 191: the sink is build-scoped — a later flag-less run in the same process stays silent
// (mirrors the task-119 clearReconstructionFailures precedent for in-process re-runs).
test("test_progress_sink_is_cleared_after_run", () => {
    // First run installs the sink via --progress.
    captureStderrLines(() => { runCli([S1_JSONL, "--json", "--progress"]); });
    // A second run WITHOUT the flag must not inherit the first run's sink.
    const stderrLines = captureStderrLines(() => { runCli([S1_JSONL, "--json"]); });
    assert.deepEqual(stderrLines, []);
});
