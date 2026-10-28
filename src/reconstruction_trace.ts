// Prints one row per transcript line with its verdict, and adds detail to chosen rows under `--details`.

import { BlockType, Verdict } from "./structures/vocabulary.ts";
import { TraceDetailMode } from "./structures/vocabulary_views.ts";
import type { LinePartition } from "./reconstruction_parse_lines.ts";
import { getRecordKindPreview } from "./reconstruction_trace_preview.ts";

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

function compareRowsByLineNumber(a: TraceRow, b: TraceRow): number {
  return a.lineNumber - b.lineNumber;
}

// Merge kept + ignored into one line-ordered row list (each ignored row's verdict is `ignore`).
function sortRows(partition: LinePartition): TraceRow[] {
  const ignoredRows: TraceRow[] = [];
  for (const line of partition.ignored) {
    ignoredRows.push({ ...line, verdict: Verdict.ignore });
  }
  const rows: TraceRow[] = [...partition.kept, ...ignoredRows];
  return rows.sort(compareRowsByLineNumber);
}

// Whether a row passes the kept/ignored filter: hideIgnored drops ignored rows, onlyIgnored drops kept rows.
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

// The ids of tool_use blocks whose tool_result block has is_error true, read from every raw line of the partition.
function collectErroredToolUseIdsInPartition(partition: LinePartition): Set<string> {
  const erroredIds = new Set<string>();
  for (const line of [...partition.kept, ...partition.ignored]) {
    const recordType = getRawRecordType(line.raw);
    if (recordType === "?") {
      continue;
    }
    const content = (JSON.parse(line.raw) as { message?: { content?: unknown } }).message?.content;
    for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
      const isErroredToolResult = block.type === BlockType.tool_result && block.is_error === true;
      if (isErroredToolResult) {
        erroredIds.add(String(block.tool_use_id));
      }
    }
  }
  return erroredIds;
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

// Returns the record type of a raw line, or `?` for bad JSON or a missing string type.
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
  const details = options.details;
  const isDetailed = details !== undefined && isRowSelected(row, details.selector);
  if (isDetailed) {
    const { type, kind, preview, pretty } = parseRawLineDescription(row.raw, erroredIds);
    if (details.mode === TraceDetailMode.full) {
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

// Render one row per line in order: filtered, optionally detailed; a `byLine` selector keeps one line.
export function renderTrace(partition: LinePartition, options: TraceOptions): string {
  const areBothFiltersSet = options.hideIgnored && options.onlyIgnored;
  if (areBothFiltersSet) {
    throw new Error("renderTrace: hideIgnored and onlyIgnored are mutually exclusive");
  }
  const only = getSoleLine(options);
  const orderedRows = sortRows(partition);
  const erroredIds = options.details === undefined ? new Set<string>() : collectErroredToolUseIdsInPartition(partition);
  const renderedRows: string[] = [];
  for (const row of orderedRows) {
    const isSoleLine = only === undefined || row.lineNumber === only;
    const isRendered = isRowPassingFilter(row, options) && isSoleLine;
    if (isRendered) {
      renderedRows.push(renderRow(row, options, erroredIds));
    }
  }
  return renderedRows.join("\n");
}

