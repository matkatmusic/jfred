// Fog-of-war boundary: allowed top-level keys per record type. Split from loadTranscript.ts.

import type { TranscriptRecord } from "../structures/envelope.ts";
import { ENVELOPE_KEYS, RecordType } from "../structures/vocabulary.ts";

// Base keys for session-meta records (file-history-snapshot excluded: no sessionId).
const META_KEYS = ["type", "sessionId"] as const;

// Union a base key group with a record's extra keys into an allow-set.
function keys(
    base: readonly string[],
    ...extra: string[]
): ReadonlySet<string> {
    return new Set([...base, ...extra]);
}

// Extra session metadata from corpus audit: session_id (CC 2.1.198+), sessionKind (background sessions).
const OBSERVED_SESSION_METADATA_KEYS = ["session_id", "sessionKind"] as const;

// Runtime fog-of-war boundary: allowed top-level keys per record type from s1 inventory and corpus audit.
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
    // Subagent fork record: carries agentId, not sessionId.
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
        // Legacy/variant spellings and retry fields from corpus audit.
        "url", "pendingBackgroundAgentCount", "preventContinuation",
        "error", "retryInMs", "retryAttempt", "maxRetries", "cause",
    ),
    [RecordType.user]: keys(
        ENVELOPE_KEYS,
        "message", "promptId", "origin", "permissionMode", "promptSource",
        "sourceToolAssistantUUID", "toolUseResult", "isMeta",
        "isVisibleInTranscriptOnly", "isCompactSummary",
        ...OBSERVED_SESSION_METADATA_KEYS,
        // subagent identity; Esc-interrupt marker; tool-result back-reference; denied permission prompt; pasted images; queued-prompt priority (audit 2026-07-05).
        "agentId", "interruptedMessageId", "sourceToolUseID", "toolDenialKind",
        "imagePasteIds", "queuePriority",
        // Newer-CC marker: this tool result ends the assistant turn (audit 2026-07-31).
        "toolEndsTurn",
    ),
};

// Ensures unmodeled fields surface loudly instead of passing silently.

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

