// Domain value objects that replace bare string primitives across the typed
// structures, so identifiers, paths, and times carry their meaning in the type
// system (strict-typing policy: avoid primitives). Each wraps the raw wire
// string, compares by value, and serializes back to that string via toJSON so
// the JSONL wire form round-trips losslessly. Time-based values use the built-in
// `Date` (JS's date-time object) directly — no wrapper needed.

// A filesystem path (cwd, file_path, backup file name, snapshot map keys).
export class Path {
    constructor(readonly value: string) {}

    toString(): string {
        return this.value;
    }

    toJSON(): string {
        return this.value;
    }

    equals(other: Path): boolean {
        return this.value === other.value;
    }
}

// An identifier of any kind (session/parent/leaf/message/bridge/tool-use ids).
// Not restricted to RFC-4122 form: s1 carries both UUIDs (sessionId) and
// prefixed ids (toolu_…, cse_…); all are modeled as Uuid so no id is primitive.
export class Uuid {
    constructor(readonly value: string) {}

    toString(): string {
        return this.value;
    }

    toJSON(): string {
        return this.value;
    }

    equals(other: Uuid): boolean {
        return this.value === other.value;
    }
}

