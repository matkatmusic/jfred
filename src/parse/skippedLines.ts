import { UnknownRecordTypeError } from "./parseRecord.ts";
import type { ProgressSink, RecordSource, SkippedLine } from "./loadTranscript.ts";
import { Path } from "../structures/domain.ts";
import { DocumentResponseKind } from "../structures/vocabulary_views.ts";

// Best-effort: called only for lines whose JSON already parsed once, but the guard covers the theoretical re-parse throw anyway.
function readLineTimestamp(text: string): Date | undefined {
  try {
    const raw = (JSON.parse(text) as { timestamp?: unknown }).timestamp;
    return typeof raw === "string" ? new Date(raw) : undefined;
  }
  catch {
    return undefined;
  }
}

// An unknown record type keeps its timestamp because its JSON parsed; malformed JSON cannot.
export function buildSkippedLine(filePath: string, lineNumber: number, text: string, error: unknown): SkippedLine {
  if (error instanceof UnknownRecordTypeError) {
    return { filePath: new Path(filePath), lineNumber, timestamp: readLineTimestamp(text), reason: error.message };
  }
  if (error instanceof SyntaxError) {
    return { filePath: new Path(filePath), lineNumber, reason: `malformed JSON: ${String(error)}` };
  }
  return { filePath: new Path(filePath), lineNumber, reason: String(error) };
}

// Tolerant mode only; strict mode rethrows unchanged. The skipped line still counts toward current/total via its loop index.
export function collectSkippedLineOrRethrow(
  error: unknown,
  tolerateUnmodeledFields: boolean,
  source: RecordSource,
  text: string,
  skippedLines: SkippedLine[],
  onProgress: ProgressSink | undefined,
): void {
  if (!tolerateUnmodeledFields) {
    throw error;
  }
  const skipped = buildSkippedLine(source.filePath, source.lineNumber, text, error);
  skippedLines.push(skipped);
  onProgress?.({ kind: DocumentResponseKind.progress, label: `skipped line ${source.lineNumber}: ${skipped.reason}` });
}
