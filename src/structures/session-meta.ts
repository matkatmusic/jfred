import type { TranscriptRecord } from "./envelope.ts";
import { RecordType, AttachmentPayloadType } from "./vocabulary.ts";
import { AgentId, Path, Uuid } from "./domain.ts";

// Session-meta records from s1 (recon/07-s1-field-inventory.md), modeled with observed top-level keys; ids are hydrated by parseRecord and accessors.

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

// `lastPrompt` is optional: one s1 last-prompt record has only `leafUuid`, which is always present.
export type LastPromptEntry = {
    type: RecordType.lastPrompt;
    sessionId: Uuid;
    leafUuid: Uuid;
    lastPrompt?: string;
};

// Opens a subagent transcript; it carries no sessionId, uuid, or timestamp.
export type ForkContextRefEntry = {
    type: RecordType.forkContextRef;
    agentId: AgentId;
    parentSessionId: Uuid;
    parentLastUuid: Uuid;
    contextLength: number;
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

// Resolve a fork-context-ref record, hydrating agentId into an AgentId and the parent pointers into Uuids.
export function getForkContextRefEntry(
    record: TranscriptRecord,
): ForkContextRefEntry | undefined {
    if (record.type !== RecordType.forkContextRef) {
        return undefined;
    }
    const raw = record as unknown as {
        agentId: string;
        parentSessionId: string;
        parentLastUuid: string;
        contextLength: number;
    };
    return {
        type: RecordType.forkContextRef,
        agentId: new AgentId(raw.agentId),
        parentSessionId: new Uuid(raw.parentSessionId),
        parentLastUuid: new Uuid(raw.parentLastUuid),
        contextLength: raw.contextLength,
    };
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

