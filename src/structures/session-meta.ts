import type { TranscriptRecord } from "./envelope.ts";
import { RecordType, AttachmentPayloadType } from "./vocabulary.ts";
import { Path, Uuid } from "./domain.ts";

// Session-meta records present in s1 (recon/07-s1-field-inventory.md). Each is modeled with exactly the top-level keys observed in s1. The shared envelope fields (sessionId, uuid, parentUuid, cwd, timestamp) are hydrated into domain objects by parseRecord; the type-specific ids (leafUuid, bridgeSessionId) are hydrated by their accessors below.

export type AiTitleEntry = {
    type: RecordType.aiTitle;
    sessionId: Uuid;
    aiTitle: string;
};

export type BridgeSessionEntry = {
    type: RecordType.bridgeSession;
    sessionId: Uuid;
    bridgeSessionId: Uuid;
    lastSequenceNum: number;
};

// `lastPrompt` is optional: in s1 one last-prompt record carries only `leafUuid` (a pointer) while the others also carry the prompt text (recon: 1x without, 3x with). `leafUuid` is always present.
export type LastPromptEntry = {
    type: RecordType.lastPrompt;
    sessionId: Uuid;
    leafUuid: Uuid;
    lastPrompt?: string;
};

export type ModeEntry = {
    type: RecordType.mode;
    sessionId: Uuid;
    mode: string;
};

export type PermissionModeEntry = {
    type: RecordType.permissionMode;
    sessionId: Uuid;
    permissionMode: string;
};

// The attachment payload's remaining fields are conditional on this discriminant and are peripheral to file-change reconstruction, so the payload is modeled minimally (discriminant + passthrough); full per-kind modeling is deferred.
export type AttachmentPayload = { type: AttachmentPayloadType } & {
    [key: string]: unknown;
};

export type AttachmentEntry = {
    type: RecordType.attachment;
    parentUuid: Uuid;
    isSidechain: boolean;
    uuid: Uuid;
    timestamp: Date;
    userType: string;
    entrypoint: string;
    cwd: Path;
    sessionId: Uuid;
    version: string;
    gitBranch: string;
    attachment: AttachmentPayload;
};

export function getModeEntry(record: TranscriptRecord): ModeEntry | undefined {
    if (record.type !== RecordType.mode) {
        return undefined;
    }
    return record as unknown as ModeEntry;
}

// Resolve a last-prompt record, hydrating its leafUuid pointer into a Uuid (sessionId is already a Uuid from parseRecord).
export function getLastPromptEntry(
    record: TranscriptRecord,
): LastPromptEntry | undefined {
    if (record.type !== RecordType.lastPrompt) {
        return undefined;
    }
    const raw = record as unknown as LastPromptEntry & { leafUuid: string };
    return { ...raw, leafUuid: new Uuid(raw.leafUuid) };
}

// Resolve a bridge-session record, hydrating its bridgeSessionId into a Uuid (sessionId is already a Uuid from parseRecord).
export function getBridgeSessionEntry(
    record: TranscriptRecord,
): BridgeSessionEntry | undefined {
    if (record.type !== RecordType.bridgeSession) {
        return undefined;
    }
    const raw = record as unknown as BridgeSessionEntry & {
        bridgeSessionId: string;
    };
    return { ...raw, bridgeSessionId: new Uuid(raw.bridgeSessionId) };
}

// The attachment record's domain fields are all envelope fields (uuid, parentUuid, sessionId, cwd, timestamp) already hydrated by parseRecord, so the typed view is a direct cast.
export function getAttachmentEntry(
    record: TranscriptRecord,
): AttachmentEntry | undefined {
    if (record.type !== RecordType.attachment) {
        return undefined;
    }
    return record as unknown as AttachmentEntry;
}

