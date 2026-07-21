import { test } from "node:test";
import assert from "node:assert/strict";
import { TraceDetailMode, Verdict } from "../src/structures/vocabulary.ts";
import { runCli } from "../src/reconstruction_cli.ts";
import { parseTraceArgs, TRACE_HELP } from "../src/reconstruction_cli_trace.ts";
import { jsonlPathsForScenario } from "./fixtures.ts";

const S37 = jsonlPathsForScenario("s37")[0]!.toString();

test("test_trace_flag_prints_kept_lines_with_verdicts", () => {
    // Step: --trace prints the verdict trace; the post-rename Read of ledger.py shows as a read-beacon.
    const out = runCli([S37, "--trace"]);
    assert.ok(out.includes("167: read-beacon"));
});

test("test_hideIgnored_flag_drops_ignored_rows", () => {
    // Step: --hideIgnored shows only kept lines — no `: ignore` row survives.
    const out = runCli([S37, "--trace", "--hideIgnored"]);
    assert.ok(!out.includes(": ignore"));
    assert.ok(out.includes("167: read-beacon"));
});

test("test_onlyIgnored_flag_drops_kept_rows", () => {
    // Step: --onlyIgnored shows only dropped lines — the read-beacon is gone, ignore rows remain.
    const out = runCli([S37, "--trace", "--onlyIgnored"]);
    assert.ok(!out.includes("167: read-beacon"));
    assert.ok(out.includes(": ignore"));
});

test("test_details_flag_with_no_args_selects_all_rows_preview_only", () => {
    // Step: bare --details defaults to enriching every row in preview-only mode.
    const parsed = parseTraceArgs([S37, "--trace", "--details"]);
    assert.deepEqual(parsed?.options.details, {
        selector: { all: true },
        mode: TraceDetailMode.previewOnly,
    });
});

test("test_details_flag_parses_a_class_selector_and_mode", () => {
    // Step: `--details bash-file-op --mode full` narrows to that Verdict class and the full render mode.
    const parsed = parseTraceArgs([S37, "--trace", "--details", "bash-file-op", "--mode", "full"]);
    assert.deepEqual(parsed?.options.details, {
        selector: { byClass: Verdict.bashFileOp },
        mode: TraceDetailMode.full,
    });
});

test("test_mode_flag_rejects_an_unknown_value", () => {
    // Step: `--mode bogus` is a usage error — no positional-mode guessing.
    assert.throws(() => parseTraceArgs([S37, "--trace", "--details", "--mode", "bogus"]));
});

test("test_details_flag_parses_a_line_selector", () => {
    // Step: `--details 124` narrows to a single line, defaulting to preview-only mode.
    const parsed = parseTraceArgs([S37, "--trace", "--details", "124"]);
    assert.deepEqual(parsed?.options.details, {
        selector: { byLine: 124 },
        mode: TraceDetailMode.previewOnly,
    });
});

test("test_line_flag_selects_a_single_line_for_details", () => {
    // Step: `--details --line 124` details only line 124, defaulting to preview-only mode.
    const parsed = parseTraceArgs([S37, "--trace", "--details", "--line", "124"]);
    assert.deepEqual(parsed?.options.details, {
        selector: { byLine: 124 },
        mode: TraceDetailMode.previewOnly,
    });
});

test("test_line_flag_composes_with_a_mode", () => {
    // Step: `--details --line 124 --mode full` details line 124 in full mode.
    const parsed = parseTraceArgs([S37, "--trace", "--details", "--line", "124", "--mode", "full"]);
    assert.deepEqual(parsed?.options.details, {
        selector: { byLine: 124 },
        mode: TraceDetailMode.full,
    });
});

test("test_help_flag_documents_details_and_mode_options", () => {
    // Step: `--trace --help` prints the flag help — the --details selector and both modes.
    const out = runCli([S37, "--trace", "--help"]);
    assert.equal(out, TRACE_HELP);
    assert.ok(out.includes("--details"));
    assert.ok(out.includes(TraceDetailMode.previewOnly));
    assert.ok(out.includes(TraceDetailMode.full));
});

