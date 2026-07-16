// The `--trace` CLI mode (s37 script-replay diagnostic, Phase A, A5): print the Step-1 verdict trace for a
// transcript and exit, with no effect on reconstruction. Split out of reconstruction_cli.ts (already at the
// 250-line cap) — runCli short-circuits to here when `--trace` is present, BEFORE its own parseArgs, so the
// `--details` selector tokens are never mistaken for the positional transcript path. Design:
// ~/.claude/plans/task-implement-script-replay-partitioned-puppy.md (Phase A, A5).

import { Path } from "./structures/domain.ts";
import { KNOWN_VERDICTS, TraceDetailMode, Verdict } from "./structures/vocabulary.ts";
import { partitionLines } from "./reconstruction_parse_lines.ts";
import { renderTrace } from "./reconstruction_trace.ts";
import type { TraceDetailSelector, TraceOptions } from "./reconstruction_trace.ts";
import { numbersOnly } from "./regex_expressions.ts";

const KNOWN_VERDICT_SET = new Set<string>(KNOWN_VERDICTS);

// Whether a token after `--details` is one of its optional args (a Verdict-class selector, a line-number
// selector, or a mode keyword) rather than the transcript path or the next flag.
function isDetailToken(token: string): boolean {
    return (
        KNOWN_VERDICT_SET.has(token) ||
        numbersOnly.test(token) ||
        token === TraceDetailMode.previewOnly ||
        token === TraceDetailMode.full
    );
}

// The `--details` selector: an explicit `--line N` wins, else the single positional token right after
// `--details` (a Verdict class or a line number), else `{ all: true }` (detail every rendered row).
function parseSelector(argv: string[], detailsAt: number): TraceDetailSelector {
    const line = parseLineFlag(argv);
    if (line !== undefined) {
        return { byLine: line };
    }
    const token = argv[detailsAt + 1];
    if (token !== undefined && KNOWN_VERDICT_SET.has(token)) {
        return { byClass: token as Verdict };
    }
    if (token !== undefined && numbersOnly.test(token)) {
        return { byLine: Number(token) };
    }
    return { all: true };
}

// The render mode from an explicit `--mode <mode>` flag (default preview-only when absent). A `--mode` with a
// value that is neither `preview-only` nor `full` is a usage error — the positional-mode guesswork is gone.
function parseMode(argv: string[]): TraceDetailMode {
    const at = argv.indexOf("--mode");
    if (at < 0) {
        return TraceDetailMode.previewOnly;
    }
    const value = argv[at + 1];
    if (value === TraceDetailMode.full || value === TraceDetailMode.previewOnly) {
        return value;
    }
    throw new Error(`--mode must be '${TraceDetailMode.previewOnly}' or '${TraceDetailMode.full}'`);
}

// An explicit `--line N` selector value, or undefined when the flag is absent / its value is not an integer.
// Overrides the `--details` positional selector so a single line can be targeted by name: `--details --line N`.
function parseLineFlag(argv: string[]): number | undefined {
    const at = argv.indexOf("--line");
    if (at < 0) {
        return undefined;
    }
    const value = Number(argv[at + 1]);
    return Number.isInteger(value) ? value : undefined;
}

// The trace options carried by argv: hideIgnored / onlyIgnored booleans and the optional `--details` block
// (its selector from a positional class/line or `--line N`, its mode from `--mode <mode>`).
function parseTraceOptions(argv: string[]): TraceOptions {
    const detailsAt = argv.indexOf("--details");
    const details = detailsAt >= 0
        ? { selector: parseSelector(argv, detailsAt), mode: parseMode(argv) }
        : undefined;
    return {
        hideIgnored: argv.includes("--hideIgnored"),
        onlyIgnored: argv.includes("--onlyIgnored"),
        details,
    };
}

// The transcript path: the first positional that is neither a flag nor a `--details` selector token.
function findTranscriptPath(argv: string[]): string | undefined {
    return argv.find((arg) => !arg.startsWith("--") && !isDetailToken(arg));
}

// The `--trace --help` text, documenting each flag and the `--details` selector + mode values.
export const TRACE_HELP = [
    "usage: reconstruction_cli <transcript.jsonl> --trace [options]",
    "  Print the Step-1 verdict for each JSONL line (diagnostic only — reconstruction is unaffected).",
    "",
    "  --hideIgnored   show only kept lines (drop every `ignore` row)",
    "  --onlyIgnored   show only ignored lines (audit what was dropped); mutually exclusive with --hideIgnored",
    "  --details [<selector>]",
    "      Enrich rows with `type=… kind=… preview=…`. With no <selector> it details every rendered row.",
    "      <selector> narrows to either a verdict class (one of: " + KNOWN_VERDICTS.join(", ") + ")",
    "                 or a single line number (e.g. 124).",
    "  --line N        show only line N, detailed (with --details); equivalent to `--details 124`",
    "  --mode <mode>   `" + TraceDetailMode.previewOnly + "` (default — a short one-line content preview)",
    "                  or `" + TraceDetailMode.full + "` (the whole record, pretty-printed under the row)",
    "  --help          show this message",
    "      e.g. `--details ignore --mode full` or `--details --line 124 --mode full`",
].join("\n");

// A `--trace` invocation. `help` short-circuits everything else (no transcript path required).
export type TraceInvocation = { jsonlPath: string; options: TraceOptions; help?: boolean };

// Parse a `--trace` invocation, or undefined when `--trace` is absent (the caller then runs the normal CLI).
// `--trace --help` returns a help-only invocation. Throws when `--trace` is given without a transcript path.
export function parseTraceArgs(argv: string[]): TraceInvocation | undefined {
    if (!argv.includes("--trace")) {
        return undefined;
    }
    if (argv.includes("--help")) {
        return { jsonlPath: "", options: {}, help: true };
    }
    const jsonlPath = findTranscriptPath(argv);
    if (jsonlPath === undefined) {
        throw new Error(TRACE_HELP);
    }
    return { jsonlPath, options: parseTraceOptions(argv) };
}

// Render the verdict trace for a parsed `--trace` invocation (or the help text when `--help` was given).
export function runTrace(invocation: TraceInvocation): string {
    if (invocation.help) {
        return TRACE_HELP;
    }
    return renderTrace(partitionLines(new Path(invocation.jsonlPath)), invocation.options);
}

