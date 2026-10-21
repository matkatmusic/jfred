// Domain value objects wrap wire strings so ids, paths, and times are typed, not bare primitives.

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

// An identifier of any kind: UUIDs and prefixed ids (toolu_, cse_) all use this type.
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

// A subagent's identifier (the `agentId` on fork-context-ref and sidechain records).
export class AgentId {
    constructor(readonly value: string) {}

    toString(): string {
        return this.value;
    }

    toJSON(): string {
        return this.value;
    }

    equals(other: AgentId): boolean {
        return this.value === other.value;
    }
}

