import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseRecord } from "./parseRecord.ts";
import type { TranscriptRecord } from "../structures/envelope.ts";
import { DocumentResponseKind, ENVELOPE_KEYS, RecordType } from "../structures/vocabulary.ts";

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

// The keys every session-meta record carries (file-history-snapshot excepted —
// it has `type` but no `sessionId`). ENVELOPE_KEYS (the conversational-record
// field list) is imported from envelope.ts as the single source.
const META_KEYS = ["type", "sessionId"] as const;

// Union a base key group with a record's extra keys into an allow-set.
function keys(
    base: readonly string[],
    ...extra: string[]
): ReadonlySet<string> {
    return new Set([...base, ...extra]);
}

// Session metadata observed on every conversational record type in real transcripts
// (2026-07-05 corpus audit of ~/Programming/jot-recovery/claude-data/projects):
// session_id is a snake_case sessionId duplicate (CC 2.1.198+); sessionKind marks
// background sessions ("bg", CC 2.1.154/2.1.173 only — unreproducible today).
const OBSERVED_SESSION_METADATA_KEYS = ["session_id", "sessionKind"] as const;

// The exact set of top-level keys each record type carries in s1
// (recon/07-s1-field-inventory.md, union across per-record variants), extended by
// the 2026-07-05 corpus audit of real transcripts (fields the scenario captures never
// produced: subagent runs, API retries, Esc-interrupts, permission denials, queued
// prompts, image pastes, web-bridge sessions, version-transient spellings — evidence
// cited per field in tests/loadTranscript.test.ts). This is the runtime expression of
// the field-level fog-of-war boundary: a record may carry a subset of these keys, but
// never a key outside its set.
export const ALLOWED_TOP_LEVEL_KEYS: Record<RecordType, ReadonlySet<string>> = {
    [RecordType.aiTitle]: keys(META_KEYS, "aiTitle"),
    [RecordType.agentName]: keys(META_KEYS, "agentName"),
    [RecordType.customTitle]: keys(META_KEYS, "customTitle"),
    [RecordType.assistant]: keys(
        ENVELOPE_KEYS, "message", "requestId", "attributionMcpServer", "attributionMcpTool",
        "attributionPlugin", "attributionSkill",
        ...OBSERVED_SESSION_METADATA_KEYS,
        // subagent identity/attribution; API-error markers (audit 2026-07-05).
        "agentId", "attributionAgent", "isApiErrorMessage", "error", "apiErrorStatus",
    ),
    [RecordType.attachment]: keys(
        ENVELOPE_KEYS, "attachment",
        ...OBSERVED_SESSION_METADATA_KEYS,
        // subagent identity (audit 2026-07-05).
        "agentId",
    ),
    [RecordType.bridgeSession]: keys(META_KEYS, "bridgeSessionId", "lastSequenceNum"),
    [RecordType.fileHistorySnapshot]: keys(
        ["type"], "messageId", "snapshot", "isSnapshotUpdate",
    ),
    // Opens real subagents/agent-*.jsonl transcripts: the forked agent and its parent
    // session (audit 2026-07-05). Carries agentId, not sessionId — META_KEYS doesn't apply.
    [RecordType.forkContextRef]: keys(
        ["type"], "agentId", "parentSessionId", "parentLastUuid", "contextLength",
    ),
    [RecordType.lastPrompt]: keys(META_KEYS, "leafUuid", "lastPrompt"),
    [RecordType.mode]: keys(META_KEYS, "mode"),
    [RecordType.permissionMode]: keys(META_KEYS, "permissionMode"),
    [RecordType.queueOperation]: keys(META_KEYS, "operation", "timestamp", "content"),
    [RecordType.system]: keys(
        ENVELOPE_KEYS,
        "subtype", "level", "content", "isMeta", "durationMs", "messageCount",
        "hasOutput", "hookAdditionalContext", "hookCount", "hookErrors",
        "hookInfos", "preventedContinuation", "stopReason", "toolUseID",
        "logicalParentUuid", "compactMetadata",
        ...OBSERVED_SESSION_METADATA_KEYS,
        // bridge_status url; turn_duration background-agent count; preventContinuation is
        // the CC 2.1.181-197 spelling of preventedContinuation; api_error retry group
        // (CC ≤2.1.179) (audit 2026-07-05).
        "url", "pendingBackgroundAgentCount", "preventContinuation",
        "error", "retryInMs", "retryAttempt", "maxRetries", "cause",
    ),
    [RecordType.user]: keys(
        ENVELOPE_KEYS,
        "message", "promptId", "origin", "permissionMode", "promptSource",
        "sourceToolAssistantUUID", "toolUseResult", "isMeta",
        "isVisibleInTranscriptOnly", "isCompactSummary",
        ...OBSERVED_SESSION_METADATA_KEYS,
        // subagent identity; Esc-interrupt marker; tool-result back-reference; denied
        // permission prompt; pasted images; queued-prompt priority (audit 2026-07-05).
        "agentId", "interruptedMessageId", "sourceToolUseID", "toolDenialKind",
        "imagePasteIds", "queuePriority",
    ),
};

// Thrown when a record carries a top-level key not modeled for its type, so a
// fog-of-war violation (a field we have not accounted for) cannot pass silently.
export class UnmodeledFieldError extends Error {
    readonly recordType: string;
    readonly fieldName: string;

    constructor(recordType: string, fieldName: string) {
        super(`Unmodeled top-level key "${fieldName}" on ${recordType} record`);
        this.name = "UnmodeledFieldError";
        this.recordType = recordType;
        this.fieldName = fieldName;
    }
}

// The top-level keys a record carries that are not modeled for its type (empty when all known).
// Exported for scripts/audit_unmodeled_fields.ts, the batch corpus auditor.
export function findUnmodeledTopLevelKeys(record: TranscriptRecord): string[] {
    const allowed = ALLOWED_TOP_LEVEL_KEYS[record.type];
    return Object.keys(record).filter((key) => !allowed.has(key));
}

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

// Load a whole transcript file into typed records. Throws on the first unknown
// record type or unmodeled top-level key.
// Load a whole transcript file into typed records. Strict by default: throws on the first unknown
// record type or unmodeled top-level key (the engine's fog-of-war guard — kept for the CLI and the
// tests). When `tolerateUnmodeledFields` is set (the viewer, which opens arbitrary real sessions
// that carry fields the scenarios never modeled), an unmodeled field is reported through
// `onProgress` — once per (type, field) per file — instead of thrown. An unknown record *type*
// still throws either way: its whole shape is unknown, not just one extra field.
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

export function loadTranscript(
    filePath: string,
    onProgress?: ProgressSink,
    tolerateUnmodeledFields = false,
): TranscriptRecord[] {
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
    const reportedUnmodeled = new Set<string>();
    for (const [lineIndex, { lineNumber, text }] of numberedLines.entries()) {
        const record = parseRecord(text);
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
    return records;
}

