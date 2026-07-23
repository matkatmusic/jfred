// The on-disk side of the file-history sidecar: the default blob reader, the default history root, the
// item-46 root-resolution chain (override → transcript-derived sibling → default), and
// the session-id scan. Split out of reconstruction_sidecar.ts (split, never condense) to keep that module
// — the pure backup→event transforms — within the 250-line cap. The `BackupReader` type itself stays in
// reconstruction_sidecar.ts (the transforms own it); this module imports it one-way.

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { getPathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import { getRecordSource, type RecordSource } from "./parse/loadTranscript.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// The default on-disk reader: <root>/<sessionId>/<backupFileName>.
export function createSidecarReader(sessionId: Uuid, root: Path): BackupReader {
    return (backupFileName) =>
        readFileSync(join(root.toString(), sessionId.toString(), backupFileName.toString()), "utf8");
}

// Claude Code's default file-history root: ~/.claude/file-history.
export function getDefaultFileHistoryRoot(): Path {
    return new Path(join(homedir(), ".claude", "file-history"));
}

// The file-history dir sitting next to a projects folder (<X>/projects → <X>/file-history),
// or undefined when no such sibling exists on disk (item 46: a tree copied out of ~/.claude
// mirrors its layout, so the blobs travel as the projects folder's sibling).
export function deriveSiblingFileHistoryRoot(projectsDir: Path): Path | undefined {
    const sibling = join(dirname(projectsDir.toString()), "file-history");
    if (!existsSync(sibling)) {
        return undefined;
    }
    return new Path(sibling);
}

// The first record that loadTranscript stamped with a source (fabricated records carry none).
function findFirstRecordSource(records: TranscriptRecord[]): RecordSource | undefined {
    for (const record of records) {
        const source = getRecordSource(record);
        if (source) {
            return source;
        }
    }
    return undefined;
}

// Derive the sibling root from where the records' transcript actually sits on disk:
// <X>/projects/<project>/y.jsonl → <X>/file-history. A strict generalization of the
// default — a live ~/.claude/projects/<p>/x.jsonl transcript lands exactly on
// ~/.claude/file-history. undefined when no record has a source or no sibling dir exists.
export function deriveFileHistoryRootFromRecords(records: TranscriptRecord[]): Path | undefined {
    const source = findFirstRecordSource(records);
    if (source === undefined) {
        return undefined;
    }
    const transcriptDir = dirname(source.filePath);
    const projectsRoot = dirname(transcriptDir);
    return deriveSiblingFileHistoryRoot(new Path(projectsRoot));
}

// The file-history root resolution chain (item 46): explicit override →
// transcript-derived sibling → ~/.claude/file-history default.
export function resolveFileHistoryRoot(records: TranscriptRecord[]): Path {
    const override = getPathOverrides().fileHistoryRoot;
    if (override) {
        return override;
    }
    const derived = deriveFileHistoryRootFromRecords(records);
    if (derived) {
        return derived;
    }
    return getDefaultFileHistoryRoot();
}

// The session id from the transcript's envelope records (the file-history dir is named for
// it). file-history-snapshot records carry none, so scan for the first that has one.
export function findSessionId(records: TranscriptRecord[]): Uuid | undefined {
    for (const record of records) {
        const sessionId = (record as { sessionId?: Uuid }).sessionId;
        if (sessionId) {
            return sessionId;
        }
    }
    return undefined;
}

// The distinct session ids across the records, in first-seen order. A merged multi-session
// transcript carries several; each session's backups live under its OWN file-history dir,
// so the reader must know all of them.
function sessionIdsOf(records: TranscriptRecord[]): Uuid[] {
    const seen = new Set<string>();
    const ids: Uuid[] = [];
    for (const record of records) {
        const sessionId = (record as { sessionId?: Uuid }).sessionId;
        if (sessionId && !seen.has(sessionId.toString())) {
            seen.add(sessionId.toString());
            ids.push(sessionId);
        }
    }
    return ids;
}

// The source entry whose projectsDir is the given transcript-derived projects root, by
// normalized-path equality. undefined when no declared source matches (that session falls
// back to the single-root chain). Exported for the multi-source root resolution (spec S5a),
// which matches sessions to sources the same way.
export function findMatchingSourceEntry(sources: SourceEntry[], projectsRoot: string): SourceEntry | undefined {
    for (const source of sources) {
        if (resolve(source.projectsDir.toString()) === resolve(projectsRoot)) {
            return source;
        }
    }
    return undefined;
}

// The file-history root for one source-stamped record (spec S4a chain: the matching
// declared source's explicit fileHistoryDir → the record's transcript-derived sibling →
// the ~/.claude default).
function resolveSourceFileHistoryRoot(recordSource: RecordSource, sources: SourceEntry[]): string {
    const projectsRoot = dirname(dirname(recordSource.filePath));
    const matchedSource = findMatchingSourceEntry(sources, projectsRoot);
    const explicitDir = matchedSource?.fileHistoryDir?.toString();
    const siblingDir = deriveSiblingFileHistoryRoot(new Path(projectsRoot))?.toString();
    return explicitDir ?? siblingDir ?? getDefaultFileHistoryRoot().toString();
}

// Per-session file-history roots for multi-source records (spec S4a, design §c5): each
// session's blobs live under the root of the source that recorded it, resolved from the
// session's first source-stamped record. Keyed by sessionId string (module-private
// internal map; the public reader surface still speaks Uuid — coding-req §1).
function computeSessionFileHistoryRoots(records: TranscriptRecord[], sources: SourceEntry[]): Map<string, string> {
    const sessionRoots = new Map<string, string>();
    for (const record of records) {
        const sessionId = (record as { sessionId?: Uuid }).sessionId;
        if (!sessionId) {
            continue;
        }
        if (sessionRoots.has(sessionId.toString())) {
            continue;
        }
        const source = getRecordSource(record);
        if (!source) {
            continue;
        }
        sessionRoots.set(sessionId.toString(), resolveSourceFileHistoryRoot(source, sources));
    }
    return sessionRoots;
}

// The on-disk file-history reader spanning every session dir the records reference: a referenced
// backup lives under whichever session took it, so read the owner's copy when the engine names one,
// else try each session in order and read the first that exists (falling back to the first session's
// path so a genuinely-missing backup throws the same ENOENT as a single-session reader). undefined
// when the records carry no session id (no backups to read). For single-session records this is
// exactly the old single-session reader. Shared by the CLI, the coverage checker, and the viewer.
export function buildSidecarReader(records: TranscriptRecord[], sources?: SourceEntry[]): BackupReader | undefined {
    const sessionIds = sessionIdsOf(records);
    if (sessionIds.length === 0) {
        return undefined;
    }
    // item 46: const root = getDefaultFileHistoryRoot().toString();
    const root = resolveFileHistoryRoot(records).toString();
    // spec S4a: with declared sources, each session reads from its OWN source's root;
    // sessions no source claims keep the single-root chain above.
    const sessionRoots = sources === undefined ? undefined : computeSessionFileHistoryRoots(records, sources);
    // task 191: close out the CLI's "building sidecar backup reader" stage — the build itself is
    // instant (blob reads happen lazily), so a hang after this line belongs to the next stage.
    reportReconstructionProgress(`sidecar reader ready: ${sessionIds.length} session(s), root ${root}`);
    return (backupFileName, sessionId) => {
        const name = backupFileName.toString();
        // The engine passes the snapshot's OWNING session: across merged sessions the same `@vN` blob
        // name recurs with different content, so we MUST read the owner's copy. Fall back to a
        // first-existing search only when the owner is unknown (a pre-sessionId caller).
        const owner = sessionId ?? sessionIds.find((id) => existsSync(join(root, id.toString(), name)));
        const ownerRoot = sessionRoots?.get((owner ?? sessionIds[0]!).toString()) ?? root;
        return readFileSync(join(ownerRoot, (owner ?? sessionIds[0]!).toString(), name), "utf8");
    };
}

