// Prints one row per transcript line with its verdict, and adds detail to chosen rows under `--details`.

import { BlockType, RecordType, ToolName, Verdict } from "./structures/vocabulary.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import { readWriteInput } from "./structures/tool-results.ts";
import { TraceDetailMode } from "./structures/vocabulary_views.ts";
import type { LinePartition } from "./reconstruction_parse_lines.ts";
import { whitespaceRuns } from "./regex_expressions.ts";

// Picks the rows that get detail: all rows (the default), every row of one verdict, or one line.
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
function sortRows(partition: LinePartition): TraceRow[] {
  const rows: TraceRow[] = [
    ...partition.kept,
    ...partition.ignored.map((line) => ({ ...line, verdict: Verdict.ignore })),
  ];
  return rows.sort((a, b) => a.lineNumber - b.lineNumber);
}

// Whether a row passes the kept/ignored filter. hideIgnored drops ignored rows; onlyIgnored drops kept rows (the two are inverses).
function isRowPassingFilter(row: TraceRow, options: TraceOptions): boolean {
  if (options.onlyIgnored) {
    return row.verdict === Verdict.ignore;
  }
  if (options.hideIgnored) {
    return row.verdict !== Verdict.ignore;
  }
  return true;
}

// Whether a `--details` selector picks this row for enrichment.
function isRowSelected(row: TraceRow, selector: TraceDetailSelector): boolean {
  if ("all" in selector) {
    return true;
  }
  if ("byClass" in selector) {
    return row.verdict === selector.byClass;
  }
  return row.lineNumber === selector.byLine;
}

// Shorten a preview to a single line of at most 40 chars, ellipsised when cut.
function trimPreview(value: string): string {
  const single = value.replace(whitespaceRuns, " ").trim();
  return single.length > 40 ? `${single.slice(0, 40)}…` : single;
}

type KindPreview = { kind: string; preview: string };

// The last part of a path: a shorter and more useful preview than the full path.
function getPathBasename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

// The ids of tool_use blocks whose tool_result block has is_error true, read from every raw line of the partition.
function collectErroredToolUseIdsInPartition(partition: LinePartition): Set<string> {
  const erroredIds = new Set<string>();
  for (const line of [...partition.kept, ...partition.ignored]) {
    if (getRawRecordType(line.raw) === "?") {
      continue;
    }
    const content = (JSON.parse(line.raw) as { message?: { content?: unknown } }).message?.content;
    for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
      if (block.type === BlockType.tool_result && block.is_error === true) {
        erroredIds.add(String(block.tool_use_id));
      }
    }
  }
  return erroredIds;
}

// A kind and preview for one block: a tool_use shows its command or file name, a text block shows its text.
function getBlockKindPreview(block: Record<string, unknown>, erroredIds: Set<string>): KindPreview | undefined {
  if (block.type === BlockType.tool_use) {
    const input = (block.input ?? {}) as { command?: string; file_path?: string };
    if (input.command !== undefined) {
      return { kind: String(block.name), preview: trimPreview(input.command) };
    }
    if (block.name === ToolName.Write && erroredIds.has(String(block.id))) {
      return { kind: String(block.name), preview: "" };
    }
    if (block.name === ToolName.Write) {
      return { kind: String(block.name), preview: getPathBasename(readWriteInput(block as unknown as ToolUseBlock).filePath.toString()) };
    }
    return { kind: String(block.name), preview: input.file_path ? getPathBasename(input.file_path) : "" };
  }
  if (block.type === BlockType.text) {
    return { kind: "text", preview: trimPreview(String(block.text ?? "")) };
  }
  return undefined;
}

// A kind and preview for a tool result, found from its shape: Read, Edit, or Write. The preview is the file name.
function getResultKindPreview(result: Record<string, unknown>): KindPreview {
  const file = result.file as { filePath?: string } | undefined;
  if (typeof file?.filePath === "string") {
    return { kind: "Read", preview: getPathBasename(file.filePath) };
  }
  const filePath = typeof result.filePath === "string" ? getPathBasename(result.filePath) : "";
  if (typeof result.oldString === "string") {
    return { kind: "Edit", preview: filePath };
  }
  if (typeof result.content === "string") {
    return { kind: "Write", preview: filePath };
  }
  return { kind: "-", preview: "" };
}

// A kind + preview for a file-history-snapshot: the files it backed up, each as `<basename>@v<version>`.
function getSnapshotKindPreview(object: Record<string, unknown>): KindPreview {
  const snapshot = object.snapshot as { trackedFileBackups?: Record<string, { version?: number }> } | undefined;
  const backups = snapshot?.trackedFileBackups ?? {};
  const files = Object.entries(backups).map(([name, backup]) => `${getPathBasename(name)}@v${backup.version}`);
  return { kind: "snapshot", preview: trimPreview(files.join(", ")) };
}

// The kind and preview of a parsed record: an attachment, a snapshot, a content block, or a tool result.
function getRecordKindPreview(object: Record<string, unknown>, erroredIds: Set<string>): KindPreview {
  const attachment = object.attachment as { type?: string; filename?: string } | undefined;
  if (typeof attachment?.type === "string") {
    return { kind: attachment.type, preview: attachment.filename ? getPathBasename(attachment.filename) : "" };
  }
  if (object.type === RecordType.fileHistorySnapshot) {
    return getSnapshotKindPreview(object);
  }
  const content = (object.message as { content?: unknown })?.content;
  for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
    const described = getBlockKindPreview(block, erroredIds);
    if (described !== undefined) {
      return described;
    }
  }
  const result = object.toolUseResult as Record<string, unknown> | undefined;
  return result ? getResultKindPreview(result) : { kind: "-", preview: "" };
}

// The type, kind, short preview, and pretty-printed record of a raw line. A bad line does not throw.
function parseRawLineDescription(raw: string, erroredIds: Set<string>): { type: string; kind: string; preview: string; pretty: string } {
  let object: Record<string, unknown>;
  try {
    object = JSON.parse(raw) as Record<string, unknown>;
  }
  catch {
    return { type: "?", kind: "-", preview: "", pretty: raw };
  }
  const type = typeof object.type === "string" ? object.type : "?";
  return { type, ...getRecordKindPreview(object, erroredIds), pretty: JSON.stringify(object, null, 2) };
}

// The record type of a raw line, or `?` when the line is not valid JSON or has no string type.
function getRawRecordType(raw: string): string {
  try {
    const type = (JSON.parse(raw) as { type?: unknown }).type;
    return typeof type === "string" ? type : "?";
  }
  catch {
    return "?";
  }
}

// Render one row. A chosen row gets detail; a plain ignored row still shows its record type.
function renderRow(row: TraceRow, options: TraceOptions, erroredIds: Set<string>): string {
  const base = `${row.lineNumber}: ${row.verdict}`;
  if (options.details !== undefined && isRowSelected(row, options.details.selector)) {
    const { type, kind, preview, pretty } = parseRawLineDescription(row.raw, erroredIds);
    if (options.details.mode === TraceDetailMode.full) {
      return `${base} — type=${type} kind=${kind}\n${pretty}`;
    }
    return `${base} — type=${type} kind=${kind} preview="${preview}"`;
  }
  if (row.verdict === Verdict.ignore) {
    return `${base} type:${getRawRecordType(row.raw)}`;
  }
  return base;
}

// The one line a `byLine` selector limits the output to, or undefined for any other selector.
function getSoleLine(options: TraceOptions): number | undefined {
  const selector = options.details?.selector;
  return selector !== undefined && "byLine" in selector ? selector.byLine : undefined;
}

// Render one row per line in original order, filtered by hideIgnored / onlyIgnored (mutually exclusive) and enriched by an optional `details` selector. A `byLine` selector also restricts the output to that one line.
export function renderTrace(partition: LinePartition, options: TraceOptions): string {
  if (options.hideIgnored && options.onlyIgnored) {
    throw new Error("renderTrace: hideIgnored and onlyIgnored are mutually exclusive");
  }
  const only = getSoleLine(options);
  const orderedRows = sortRows(partition);
  const filteredRows = orderedRows.filter((row) => isRowPassingFilter(row, options));
  const selectedRows = filteredRows.filter((row) => only === undefined || row.lineNumber === only);
  const erroredIds = options.details === undefined ? new Set<string>() : collectErroredToolUseIdsInPartition(partition);
  const renderedRows = selectedRows.map((row) => renderRow(row, options, erroredIds));
  return renderedRows.join("\n");
}

