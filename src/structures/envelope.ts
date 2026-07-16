import type { Path, Uuid } from "./domain.ts";
import type { RecordType } from "./vocabulary.ts";

// Envelope fields carried by the conversational records (user / assistant /
// attachment) in s1. Session-meta records carry only a subset, so every field
// below `type` is optional. Only envelope keys actually present in s1 are
// modeled here (recon/07-s1-field-inventory.md); per-variant field typing is
// layered on in later tasks.
//
// Domain-typed fields (id → Uuid, cwd → Path, timestamp → Date) are hydrated
// from their wire strings by parseRecord, so the runtime record matches these
// types. Remaining strings (gitBranch, version, userType, entrypoint, slug) are
// free-form values with no narrower domain type. (slug is a conversation slug
// emitted by newer Claude Code, seen on every envelope record in the
// compact-session scenarios.)
export type EnvelopeBase = {
    type: RecordType;
    uuid?: Uuid;
    parentUuid?: Uuid | null;
    sessionId?: Uuid;
    isSidechain?: boolean;
    cwd?: Path;
    gitBranch?: string;
    version?: string;
    timestamp?: Date;
    userType?: string;
    entrypoint?: string;
    slug?: string;
    origin?: { kind: string };
};

// A parsed transcript record. Task 1 guarantees only that `type` is a known
// RecordType; later tasks narrow specific variants. The index signature carries
// through fields those later tasks model — the Task 6 gate enforces at runtime
// that no top-level key is left unmodeled.
export type TranscriptRecord = EnvelopeBase & { [key: string]: unknown };

