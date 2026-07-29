// Human-readable verdict trace over a LinePartition (s37 script-replay diagnostic, Phase A). Renders one row per line in original order — `<lineNumber>: <verdict>` — filtered by hideIgnored / onlyIgnored and optionally enriched (type + kind + preview, or the full pretty-printed record) under `--details`. Split out of reconstruction_parse_lines.ts to keep both files within the 250-line cap. Design: ~/.claude/plans/task-implement-script-replay-partitioned-puppy.md (Phase A, A4).

import { BlockType, RecordType, TraceDetailMode, Verdict } from "./structures/vocabulary.ts";
import type { LinePartition } from "./reconstruction_parse_lines.ts";
import { whitespaceRuns } from "./regex_expressions.ts";

// Which rows a `--details` render enriches: every rendered row (the no-selector default), every row of a Verdict class, or one specific line.
export type TraceDetailSelector =
    | { all: true }
    | { byClass: Verdict }
    | { byLine: number };

export type TraceDetailOptions = {
    selector: TraceDetailSelector;
    mode: TraceDetailMode;
};

export type TraceOptions = {
    hideIgnored?: boolean;
    onlyIgnored?: boolean;
    details?: TraceDetailOptions;
};

// One row in original line order, normalising an IgnoredLine's implicit `ignore` verdict.
type TraceRow = { lineNumber: number; verdict: Verdict; raw: string };

// Merge kept + ignored into one line-ordered row list (each ignored row's verdict is `ignore`).
function orderRows(partition: LinePartition): TraceRow[] {
    const rows: TraceRow[] = [
        ...partition.kept,
        ...partition.ignored.map((line) => ({ ...line, verdict: Verdict.ignore })),
    ];
    return rows.sort((a, b) => a.lineNumber - b.lineNumber);
}

// Whether a row passes the kept/ignored filter. hideIgnored drops ignored rows; onlyIgnored drops kept rows (the two are inverses).
function rowPassesFilter(row: TraceRow, options: TraceOptions): boolean {
    if (options.onlyIgnored) {
        return row.verdict === Verdict.ignore;
    }
    if (options.hideIgnored) {
        return row.verdict !== Verdict.ignore;
    }
    return true;
}

// Whether a `--details` selector picks this row for enrichment.
function rowIsSelected(row: TraceRow, selector: TraceDetailSelector): boolean {
    if ("all" in selector) {
        return true;
    }
    if ("byClass" in selector) {
        return row.verdict === selector.byClass;
    }
    return row.lineNumber === selector.byLine;
}

// Shorten a preview to a single line of at most 40 chars, ellipsised when cut.
function truncate(value: string): string {
    const single = value.replace(whitespaceRuns, " ").trim();
    return single.length > 40 ? `${single.slice(0, 40)}…` : single;
}

type KindPreview = { kind: string; preview: string };

// The last path segment of a (possibly absolute) path — far more useful as a preview than a long tmp prefix.
function basename(path: string): string {
    const segments = path.split("/");
    return segments[segments.length - 1] || path;
}

// A kind + preview for one content block: a tool_use shows its name + command (or file basename); a text block shows its text. undefined when the block carries neither.
function describeBlock(block: Record<string, unknown>): KindPreview | undefined {
    if (block.type === BlockType.tool_use) {
        const input = (block.input ?? {}) as { command?: string; file_path?: string };
        if (input.command !== undefined) {
            return { kind: String(block.name), preview: truncate(input.command) };
        }
        return { kind: String(block.name), preview: input.file_path ? basename(input.file_path) : "" };
    }
    if (block.type === BlockType.text) {
        return { kind: "text", preview: truncate(String(block.text ?? "")) };
    }
    return undefined;
}

// A kind + preview for a user record's tool result, inferred from its shape: a Read result nests file content, an Edit result carries before/after strings, a Write result carries content. Preview is the file basename.
function describeResult(result: Record<string, unknown>): KindPreview {
    const file = result.file as { filePath?: string } | undefined;
    if (typeof file?.filePath === "string") {
        return { kind: "Read", preview: basename(file.filePath) };
    }
    const filePath = typeof result.filePath === "string" ? basename(result.filePath) : "";
    if (typeof result.oldString === "string") {
        return { kind: "Edit", preview: filePath };
    }
    if (typeof result.content === "string") {
        return { kind: "Write", preview: filePath };
    }
    return { kind: "-", preview: "" };
}

// A kind + preview for a file-history-snapshot: the files it backed up, each as `<basename>@v<version>`.
function describeSnapshot(object: Record<string, unknown>): KindPreview {
    const snapshot = object.snapshot as { trackedFileBackups?: Record<string, { version?: number }> } | undefined;
    const backups = snapshot?.trackedFileBackups ?? {};
    const files = Object.entries(backups).map(([name, backup]) => `${basename(name)}@v${backup.version}`);
    return { kind: "snapshot", preview: truncate(files.join(", ")) };
}

// The tool/attachment kind + content preview of a parsed record, dispatched by shape: an attachment (e.g.  edited_text_file), a file-history-snapshot, a tool_use / text content block, or a tool result on a user record.
function describeRecord(object: Record<string, unknown>): KindPreview {
    const attachment = object.attachment as { type?: string; filename?: string } | undefined;
    if (typeof attachment?.type === "string") {
        return { kind: attachment.type, preview: attachment.filename ? basename(attachment.filename) : "" };
    }
    if (object.type === RecordType.fileHistorySnapshot) {
        return describeSnapshot(object);
    }
    const content = (object.message as { content?: unknown })?.content;
    for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
        const described = describeBlock(block);
        if (described !== undefined) {
            return described;
        }
    }
    const result = object.toolUseResult as Record<string, unknown> | undefined;
    return result ? describeResult(result) : { kind: "-", preview: "" };
}

// The record `type`, tool/attachment `kind`, a short preview, and the pretty-printed record of a raw line — read from the plain JSON (not the hydrated record) so `full` can pretty-print and an odd line never throws.
function describeRaw(raw: string): { type: string; kind: string; preview: string; pretty: string } {
    let object: Record<string, unknown>;
    try {
        object = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return { type: "?", kind: "-", preview: "", pretty: raw };
    }
    const type = typeof object.type === "string" ? object.type : "?";
    return { type, ...describeRecord(object), pretty: JSON.stringify(object, null, 2) };
}

// The record `type` of a raw line, read on its own (cheaper than describeRaw — no pretty-print). `?` when the line is not parseable JSON or carries no string `type`.
function recordTypeOf(raw: string): string {
    try {
        const type = (JSON.parse(raw) as { type?: unknown }).type;
        return typeof type === "string" ? type : "?";
    } catch {
        return "?";
    }
}

// Render one row. A `--details`-selected row is enriched (previewOnly: type + kind + preview; full: type + kind then the pretty-printed record). A bare ignored row still surfaces its record `type:` — kept rows already name their type via the verdict, so this gives drops the same at-a-glance "what was this line".
function renderRow(row: TraceRow, options: TraceOptions): string {
    const base = `${row.lineNumber}: ${row.verdict}`;
    if (options.details !== undefined && rowIsSelected(row, options.details.selector)) {
        const { type, kind, preview, pretty } = describeRaw(row.raw);
        if (options.details.mode === TraceDetailMode.full) {
            return `${base} — type=${type} kind=${kind}\n${pretty}`;
        }
        return `${base} — type=${type} kind=${kind} preview="${preview}"`;
    }
    if (row.verdict === Verdict.ignore) {
        return `${base} type:${recordTypeOf(row.raw)}`;
    }
    return base;
}

// The single line a `byLine` detail selector restricts the output to (`--line N` / `--details N`), or undefined for an `all` / `byClass` selector (which render every row). A line selector names one specific line, so the trace shows only that line — detailed — rather than enriching it amid every other row.
function soleLine(options: TraceOptions): number | undefined {
    const selector = options.details?.selector;
    return selector !== undefined && "byLine" in selector ? selector.byLine : undefined;
}

// Render one row per line in original order, filtered by hideIgnored / onlyIgnored (mutually exclusive) and enriched by an optional `details` selector. A `byLine` selector also restricts the output to that one line.
export function renderTrace(partition: LinePartition, options: TraceOptions): string {
    if (options.hideIgnored && options.onlyIgnored) {
        throw new Error("renderTrace: hideIgnored and onlyIgnored are mutually exclusive");
    }
    const only = soleLine(options);
    const orderedRows = orderRows(partition);
    const filteredRows = orderedRows.filter((row) => rowPassesFilter(row, options));
    const selectedRows = filteredRows.filter((row) => only === undefined || row.lineNumber === only);
    const renderedRows = selectedRows.map((row) => renderRow(row, options));
    return renderedRows.join("\n");
}

