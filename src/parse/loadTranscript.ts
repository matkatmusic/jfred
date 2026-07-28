import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseRecord, UnknownRecordTypeError } from "./parseRecord.ts";
import { findUnmodeledTopLevelKeys, UnmodeledFieldError } from "./recordKeys.ts";
import type { TranscriptRecord } from "../structures/envelope.ts";
import { Path } from "../structures/domain.ts";
import { DocumentResponseKind } from "../structures/vocabulary.ts";

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


function assertOnlyKnownTopLevelKeys(record: TranscriptRecord): void {
    const unmodeled = findUnmodeledTopLevelKeys(record);
    if (unmodeled.length > 0) {
        throw new UnmodeledFieldError(record.type, unmodeled[0]!);
    }
}

export function parseTranscriptLine(line: string): TranscriptRecord {
    const record = parseRecord(line);
    assertOnlyKnownTopLevelKeys(record);
    return record;
}

// Strict mode guards the CLI/tests; tolerant mode lets the viewer open real sessions with unmodeled fields, reporting each once.
function reportUnmodeledTopLevelFields(
    record: TranscriptRecord,
    reportedUnmodeled: Set<string>,
    onProgress: ProgressSink | undefined,
): void {
    for (const key of findUnmodeledTopLevelKeys(record)) {
        reportUnmodeledFieldOnce(record, key, reportedUnmodeled, onProgress);
    }
}

function reportUnmodeledFieldOnce(
    record: TranscriptRecord,
    key: string,
    reportedUnmodeled: Set<string>,
    onProgress: ProgressSink | undefined,
): void {
    const reportId = `${record.type}::${key}`;
    if (!reportedUnmodeled.has(reportId)) {
        reportedUnmodeled.add(reportId);
        onProgress?.({ kind: DocumentResponseKind.progress, label: `unmodeled field "${key}" on ${record.type} record` });
    }
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

// Best-effort: called only for lines whose JSON already parsed once, but the guard covers the theoretical re-parse throw anyway.
function readLineTimestamp(text: string): Date | undefined {
    try {
        const raw = (JSON.parse(text) as { timestamp?: unknown }).timestamp;
        return typeof raw === "string" ? new Date(raw) : undefined;
    } catch {
        return undefined;
    }
}

// An unknown record type keeps its timestamp because its JSON parsed; malformed JSON cannot.
function describeSkippedLine(filePath: string, lineNumber: number, text: string, error: unknown): SkippedLine {
    if (error instanceof UnknownRecordTypeError) {
        return { filePath: new Path(filePath), lineNumber, timestamp: readLineTimestamp(text), reason: error.message };
    }
    if (error instanceof SyntaxError) {
        return { filePath: new Path(filePath), lineNumber, reason: `malformed JSON: ${String(error)}` };
    }
    return { filePath: new Path(filePath), lineNumber, reason: String(error) };
}

// Tolerant mode only; strict mode rethrows unchanged. The skipped line still counts toward current/total via its loop index.
function captureSkippedLineOrRethrow(
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
    const skipped = describeSkippedLine(source.filePath, source.lineNumber, text, error);
    skippedLines.push(skipped);
    onProgress?.({ kind: DocumentResponseKind.progress, label: `skipped line ${source.lineNumber}: ${skipped.reason}` });
}

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
    const numberedLines = lines
        .map((text, index) => ({ lineNumber: index + 1, text }))
        .filter((entry) => entry.text.trim().length > 0);
    onProgress?.({ kind: DocumentResponseKind.progress, label: PROGRESS_LABEL_PARSING_RECORDS });
    const records: TranscriptRecord[] = [];
    const skippedLines: SkippedLine[] = [];
    const reportedUnmodeled = new Set<string>();
    for (const [lineIndex, { lineNumber, text }] of numberedLines.entries()) {
        let record: TranscriptRecord;
        try {
            record = parseRecord(text);
        } catch (error) {
            captureSkippedLineOrRethrow(error, tolerateUnmodeledFields, { filePath, lineNumber }, text, skippedLines, onProgress);
            continue;
        }
        recordSources.set(record, { filePath, lineNumber });
        if (tolerateUnmodeledFields) {
            reportUnmodeledTopLevelFields(record, reportedUnmodeled, onProgress);
        } else {
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

