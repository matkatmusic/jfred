// The field-level fog-of-war boundary: the exact top-level keys each record type may carry,
// and the guard machinery over it. Split from loadTranscript.ts (250-line cap); the loader
// imports the guard, the batch corpus auditor (scripts/audit_unmodeled_fields.ts) imports the
// allow-set directly.

import type { TranscriptRecord } from "../structures/envelope.ts";
import { ENVELOPE_KEYS, RecordType } from "../structures/vocabulary.ts";

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
        // reasoning-effort level on assistant turns (s87 capture, 2026-07-17).
        "effort",
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
    // Like file-history-snapshot, no sessionId (s87 capture, 2026-07-17).
    [RecordType.fileHistoryDelta]: keys(
        ["type"], "messageId", "snapshotMessageId", "trackingPath", "backup", "timestamp",
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
export function findUnmodeledTopLevelKeys(record: TranscriptRecord): string[] {
    const allowed = ALLOWED_TOP_LEVEL_KEYS[record.type];
    return Object.keys(record).filter((key) => !allowed.has(key));
}
