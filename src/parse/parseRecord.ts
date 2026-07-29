import type { TranscriptRecord } from "../structures/envelope.ts";
import {
    ENVELOPE_ID_KEYS,
    KNOWN_RECORD_TYPES,
    RecordType,
} from "../structures/vocabulary.ts";
import { Path, Uuid } from "../structures/domain.ts";

// Fail loudly on unmodeled record types to prevent silent fog-of-war violations.
export class UnknownRecordTypeError extends Error {
    readonly recordType: string;

    constructor(recordType: string) {
        super(`Unknown transcript record type: ${recordType}`);
        this.name = "UnknownRecordTypeError";
        this.recordType = recordType;
    }
}

const KNOWN_TYPE_SET = new Set<string>(KNOWN_RECORD_TYPES);

function isKnownRecordType(value: unknown): value is RecordType {
    if (typeof value !== "string") {
        return false;
    }
    return KNOWN_TYPE_SET.has(value);
}

// Null parentUuid (conversation root) is intentionally left as-is.
function hydrateIdKey(record: Record<string, unknown>, key: string): void {
    if (typeof record[key] === "string") {
        record[key] = new Uuid(record[key] as string);
    }
}

// Convert wire strings to domain types (Uuid, Path, Date) in place.
function hydrateEnvelope(record: Record<string, unknown>): void {
    for (const key of ENVELOPE_ID_KEYS) {
        hydrateIdKey(record, key);
    }
    if (typeof record.cwd === "string") {
        record.cwd = new Path(record.cwd);
    }
    if (typeof record.timestamp === "string") {
        record.timestamp = new Date(record.timestamp);
    }
}

// Parse and validate one JSONL line, hydrating envelope fields to domain types.
export function parseRecord(line: string): TranscriptRecord {
    const parsed = JSON.parse(line) as Record<string, unknown> & {
        type?: unknown;
    };
    if (!isKnownRecordType(parsed.type)) {
        throw new UnknownRecordTypeError(String(parsed.type));
    }
    hydrateEnvelope(parsed);
    return parsed as TranscriptRecord;
}


