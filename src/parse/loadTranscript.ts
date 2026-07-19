import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseRecord, UnknownRecordTypeError } from "./parseRecord.ts";
import { findUnmodeledTopLevelKeys, UnmodeledFieldError } from "./recordKeys.ts";
import type { TranscriptRecord } from "../structures/envelope.ts";
import { Path } from "../structures/domain.ts";
import { DocumentResponseKind } from "../structures/vocabulary.ts";

// One announcement emitted while a document builds. `current`/`total` ride only on the
// counted per-record parse events. Lives in the lowest module in the import chain
// (viewer_api.ts imports from here, never the reverse) so no module needs to import upward.
export type ProgressEvent = {
    kind: DocumentResponseKind.progress;
    label: string;
    current?: number;   // present only on counted per-record events
    total?: number;     // present only on counted per-record events
};
export type ProgressSink = (event: ProgressEvent) => void;

export const PROGRESS_LABEL_PARSING_RECORDS = "parsing records";

// Where a parsed record came from: the transcript file and its 1-based line number in it. Held
// in a WeakMap keyed by record identity (not stamped ON the record) so the record's top-level
// shape stays exactly the file's — the fog-of-war field gate never sees a synthetic key.
export type RecordSource = { filePath: string; lineNumber: number };
const recordSources = new WeakMap<TranscriptRecord, RecordSource>();

export function getRecordSource(record: TranscriptRecord): RecordSource | undefined {
    return recordSources.get(record);
}

// " [file.jsonl:123]" for a known source, "" otherwise — the clickable token appended to console
// labels (the client's matchJsonlSourceLink parses it back into a raw-line jump).
export function formatRecordSourceToken(source: RecordSource | undefined): string {
    if (source === undefined) {
        return "";
    }
    return ` [${basename(source.filePath)}:${source.lineNumber}]`;
}

// The field allow-set and its guard machinery (ALLOWED_TOP_LEVEL_KEYS, UnmodeledFieldError,
// findUnmodeledTopLevelKeys) live in recordKeys.ts (250-line cap split).

function assertOnlyKnownTopLevelKeys(record: TranscriptRecord): void {
    const unmodeled = findUnmodeledTopLevelKeys(record);
    if (unmodeled.length > 0) {
        throw new UnmodeledFieldError(record.type, unmodeled[0]!);
    }
}

// Parse one JSONL line into a typed record, validating both that its `type` is
// known (parseRecord) and that all its top-level keys are modeled for that type.
export function parseTranscriptLine(line: string): TranscriptRecord {
    const record = parseRecord(line);
    assertOnlyKnownTopLevelKeys(record);
    return record;
}

// Load a whole transcript file into typed records. Strict by default: throws on the first unknown
// record type or unmodeled top-level key (the engine's fog-of-war guard — kept for the CLI and the
// tests). When `tolerateUnmodeledFields` is set (the viewer, which opens arbitrary real sessions
// that carry fields the scenarios never modeled), an unmodeled field is reported through
// `onProgress` — once per (type, field) per file — instead of thrown, and a line that cannot
// parse at all (malformed JSON, an unknown record type, a hydration throw) is skipped, reported
// through `onProgress`, and captured as a SkippedLine; only strict mode still throws on those.
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

// One line the tolerant loader could not parse: where it was, why, and (when the raw JSON
// still carried one) its timestamp — the webapp uses it to place the gap in the timeline.
export type SkippedLine = {
    filePath: Path;
    lineNumber: number;
    timestamp?: Date;
    reason: string;
};

// A loaded transcript: the parsed records plus every line tolerant mode skipped (always
// empty in strict mode, which throws instead).
export type LoadedTranscript = {
    records: TranscriptRecord[];
    skippedLines: SkippedLine[];
};

// The `timestamp` wire string of a line, hydrated to a Date — best-effort: undefined when the
// re-parse fails, the field is absent, or it is not a string. Called only for lines whose JSON
// already parsed once (the guard covers the theoretical re-parse throw anyway).
function readLineTimestamp(text: string): Date | undefined {
    try {
        const raw = (JSON.parse(text) as { timestamp?: unknown }).timestamp;
        return typeof raw === "string" ? new Date(raw) : undefined;
    } catch {
        return undefined;
    }
}

// Turn one tolerant-mode parse throw into its SkippedLine: an unknown record type keeps its
// message (and the line's timestamp, readable because the JSON parsed); malformed JSON gets a
// "malformed JSON" reason; anything else (a hydration throw) is stringified as-is.
function describeSkippedLine(filePath: string, lineNumber: number, text: string, error: unknown): SkippedLine {
    if (error instanceof UnknownRecordTypeError) {
        return { filePath: new Path(filePath), lineNumber, timestamp: readLineTimestamp(text), reason: error.message };
    }
    if (error instanceof SyntaxError) {
        return { filePath: new Path(filePath), lineNumber, reason: `malformed JSON: ${String(error)}` };
    }
    return { filePath: new Path(filePath), lineNumber, reason: String(error) };
}

// Capture one unparseable line as a SkippedLine, reporting it through `onProgress` — tolerant
// mode only; strict mode rethrows the parse error unchanged (the fog-of-war guard). The skipped
// line keeps its slot in the current/total arithmetic via its loop index (total stays
// numberedLines.length).
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
    console.log(`   Loading transcript from ${filePath}`);   // pre-existing CLI line — keep
    onProgress?.({ kind: DocumentResponseKind.progress, label: `loading ${basename(filePath)}` });
    const fileText = readFileSync(filePath, "utf8");
    const lines = fileText.split("\n");
    // Pair each line with its 1-based FILE line number before dropping blanks, so a record's
    // source line matches what an editor shows for the .jsonl.
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
        // ponytail: unthrottled — one event per record by user decision; add a stride
        // throttle here if a 100k-line file ever makes the stream measurably slow.
        onProgress?.({
            kind: DocumentResponseKind.progress,
            label: `${record.type}${formatRecordSourceToken({ filePath, lineNumber })}`,
            current: lineIndex + 1,
            total: numberedLines.length,
        });
    }
    return { records, skippedLines };
}

