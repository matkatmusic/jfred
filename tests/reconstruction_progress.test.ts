// Task 191: --progress and --progress-all route engine progress events to stderr, so stdout stays pure JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCli } from "../src/reconstruction_cli.ts";
import { buildStderrProgressSink } from "../src/reconstruction_progress.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
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

// Task 191: --json stdout is pure JSON; the old "Loading transcript" console.log line is retired.
test("test_json_stdout_carries_no_loading_lines", () => {
    // Run the CLI in --json mode with console.log captured.
    let out = "";
    const loggedLines = captureConsoleLogLines(() => { out = executeCli([S1_JSONL, "--json"]); });
    // The returned stdout payload parses as JSON with no leading noise.
    JSON.parse(out);
    // Nothing was printed to stdout during the run.
    assert.deepEqual(loggedLines.filter((line) => line.includes("Loading transcript")), []);
});

// Task 191: --progress prints uncounted stage labels to stderr and filters counted per-record events.
test("test_progress_flag_writes_stage_labels_to_stderr", () => {
    // Run the CLI with --progress and stderr captured.
    const stderrLines = captureStderrLines(() => { executeCli([S1_JSONL, "--json", "--progress"]); });
    const joined = stderrLines.join("");
    // Load-phase stage labels and the sidecar-reader announcement appear.
    assert.ok(joined.includes("parsing records"));
    assert.ok(joined.includes("building sidecar backup reader"));
    // The sidecar build reports its result, and stage labels cover the gap before the first target line.
    assert.ok(joined.includes("sidecar reader ready"));
    assert.ok(joined.includes("finding conversation branches"));
    assert.ok(joined.includes("extracting file events"));
    // No counted per-item event leaks through at stage level.
    assert.deepEqual(stderrLines.filter((line) => /\(\d+\/\d+\)\n$/.test(line)), []);
});

// Task 191: --progress-all keeps the counted per-record events, formatted "<label> (<i>/<n>)".
test("test_progress_all_flag_writes_counted_record_events", () => {
    // Run the CLI with --progress-all and stderr captured.
    const stderrLines = captureStderrLines(() => { executeCli([S1_JSONL, "--json", "--progress-all"]); });
    // At least one counted per-record event was written.
    assert.ok(stderrLines.some((line) => /\(\d+\/\d+\)\n$/.test(line)));
});

// Stage-level heartbeat: a counted event surfaces once the stream stays silent past the heartbeat window.
test("test_stage_level_heartbeat_surfaces_counted_event_after_silence", () => {
    const sink = buildStderrProgressSink(false);
    const originalNow = Date.now;
    try {
        let nowMs = originalNow();
        Date.now = () => nowMs;
        // Within the window, counted events stay filtered at stage level.
        const early = captureStderrLines(() => {
            sink({ kind: DocumentResponseKind.progress, label: "scanning branch tips", current: 1, total: 9 });
        });
        assert.deepEqual(early, []);
        // After the silence window, the next counted event surfaces as a heartbeat.
        nowMs += 60_000;
        const late = captureStderrLines(() => {
            sink({ kind: DocumentResponseKind.progress, label: "scanning branch tips", current: 2, total: 9 });
        });
        assert.deepEqual(late, ["scanning branch tips (2/9)\n"]);
        // The heartbeat write resets the window, so the next counted event is filtered again.
        const afterHeartbeat = captureStderrLines(() => {
            sink({ kind: DocumentResponseKind.progress, label: "scanning branch tips", current: 3, total: 9 });
        });
        assert.deepEqual(afterHeartbeat, []);
    } finally {
        Date.now = originalNow;
    }
});

// Task 191: the sink is build-scoped, so a later flag-less run in the same process stays silent.
test("test_progress_sink_is_cleared_after_run", () => {
    // First run installs the sink via --progress.
    captureStderrLines(() => { executeCli([S1_JSONL, "--json", "--progress"]); });
    // A second run WITHOUT the flag must not inherit the first run's sink.
    const stderrLines = captureStderrLines(() => { executeCli([S1_JSONL, "--json"]); });
    assert.deepEqual(stderrLines, []);
});
