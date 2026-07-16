import type { TranscriptRecord } from "../structures/envelope.ts";
import {
    ENVELOPE_ID_KEYS,
    KNOWN_RECORD_TYPES,
    RecordType,
} from "../structures/vocabulary.ts";
import { Path, Uuid } from "../structures/domain.ts";

// Thrown when a transcript line carries a `type` outside the known s1
// vocabulary. Surfacing this loudly prevents a fog-of-war violation (a record
// shape we have not modeled) from passing silently.
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

// parentUuid can be null at the conversation root; hydration leaves null in
// place (ENVELOPE_ID_KEYS is the shared envelope id-field list from envelope.ts).
function hydrateIdKey(record: Record<string, unknown>, key: string): void {
    if (typeof record[key] === "string") {
        record[key] = new Uuid(record[key] as string);
    }
}

// Hydrate the domain-typed envelope fields (ids → Uuid, cwd → Path,
// timestamp → Date) in place, so the runtime record matches EnvelopeBase. Only
// fields actually present are touched; session-meta records carry only a subset.
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

// Parse one JSONL line into a typed transcript record, validating that its
// `type` is a known s1 record type (throws UnknownRecordTypeError otherwise) and
// hydrating its envelope domain fields from their wire strings.
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

