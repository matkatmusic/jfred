import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseRecord } from "./parseRecord.ts";
import { assertOnlyKnownTopLevelKeys, reportUnmodeledTopLevelFields } from "./unmodeledFields.ts";
import { collectSkippedLineOrRethrow } from "./skippedLines.ts";
import type { TranscriptRecord } from "../structures/envelope.ts";
import { Path } from "../structures/domain.ts";
import { DocumentResponseKind } from "../structures/vocabulary_views.ts";

// Lives in the lowest module of the import chain so no module needs to import upward.
export type ProgressEvent = {
  kind: DocumentResponseKind.progress;
  label: string;
  current?: number;   // present only on counted per-record events
  total?: number;     // present only on counted per-record events
};
export type ProgressSink = (event: ProgressEvent) => void;

export const PROGRESS_LABEL_PARSING_RECORDS = "parsing records";

// WeakMap preserves the record's original shape for fog-of-war gating.
export type RecordSource = { filePath: string; lineNumber: number };
const recordSources = new WeakMap<TranscriptRecord, RecordSource>();

export function getRecordSource(record: TranscriptRecord): RecordSource | undefined {
  return recordSources.get(record);
}

// The multi-source identity join clones records to remap paths, and a stampless clone would break per-source file-history resolution.
export function setRecordSource(record: TranscriptRecord, source: RecordSource): void {
  recordSources.set(record, source);
}

// The clickable token appended to console labels; the client's matchJsonlSourceLink parses it back into a raw-line jump.
export function formatRecordSourceToken(source: RecordSource | undefined): string {
  if (source === undefined) {
    return "";
  }
  return ` [${basename(source.filePath)}:${source.lineNumber}]`;
}


export function parseTranscriptLine(line: string): TranscriptRecord {
  const record = parseRecord(line);
  assertOnlyKnownTopLevelKeys(record);
  return record;
}

// The timestamp is present when the raw JSON carried one; the webapp uses it to place the gap.
export type SkippedLine = {
  filePath: Path;
  lineNumber: number;
  timestamp?: Date;
  reason: string;
};

// `skippedLines` is always empty in strict mode, which throws instead.
export type LoadedTranscript = {
  records: TranscriptRecord[];
  skippedLines: SkippedLine[];
};

export function loadTranscript(
  filePath: string,
  onProgress?: ProgressSink,
  tolerateUnmodeledFields = false,
): LoadedTranscript {
  // Task 191: the stdout log was retired; the `loading <file>` progress event replaces it.
  onProgress?.({ kind: DocumentResponseKind.progress, label: `loading ${basename(filePath)}` });
  const fileText = readFileSync(filePath, "utf8");
  const lines = fileText.split("\n");
  // Number lines BEFORE dropping blanks, so a record's source line matches what an editor shows.
  const numberedLines: { lineNumber: number; text: string }[] = [];
  for (const [index, text] of lines.entries()) {
    const trimmedText = text.trim();
    if (trimmedText.length > 0)
      numberedLines.push({ lineNumber: index + 1, text });
  }
  onProgress?.({ kind: DocumentResponseKind.progress, label: PROGRESS_LABEL_PARSING_RECORDS });
  const records: TranscriptRecord[] = [];
  const skippedLines: SkippedLine[] = [];
  const reportedUnmodeled = new Set<string>();
  for (const [lineIndex, { lineNumber, text }] of numberedLines.entries()) {
    let record: TranscriptRecord;
    try {
      record = parseRecord(text);
    }
    catch (error) {
      collectSkippedLineOrRethrow(error, tolerateUnmodeledFields, { filePath, lineNumber }, text, skippedLines, onProgress);
      continue;
    }
    recordSources.set(record, { filePath, lineNumber });
    if (tolerateUnmodeledFields) {
      reportUnmodeledTopLevelFields(record, reportedUnmodeled, onProgress);
    }
    else {
      assertOnlyKnownTopLevelKeys(record);
    }
    records.push(record);
    // ponytail: unthrottled by design; add a stride throttle if a 100k-line file ever makes the stream measurably slow.
    onProgress?.({
      kind: DocumentResponseKind.progress,
      label: `${record.type}${formatRecordSourceToken({ filePath, lineNumber })}`,
      current: lineIndex + 1,
      total: numberedLines.length,
    });
  }
  return { records, skippedLines };
}

