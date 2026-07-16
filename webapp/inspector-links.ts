// Link/anchor model for the JSON inspector: wire types over parsed JSONL lines,
// per-transcript link maps, snapshot/backup anchors, revision routes, and tool-flow
// navigation targets. Rendering lives in inspector-json.ts; the pane in inspector.ts.

import { routeToFileHistory } from "./app-routes.ts";

// ── local wire types (parsed JSONL is dynamic; these name only the fields this file reads) ──

// One message content block as serialized in a transcript line.
export type WireContentBlock = {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    content?: string | WireContentBlock[];
};

// One parsed JSONL record, reduced to the fields the inspector inspects.
export type WireRecord = {
    uuid?: string;
    type?: string;
    message?: { content?: string | WireContentBlock[] };
    snapshot?: { trackedFileBackups?: Record<string, WireBackupEntry> };
};

// A shown line's parsed value: a record, null (a literal "null" line), or the raw text of a
// non-JSON line.
export type WireValue = WireRecord | string | null;

// One trackedFileBackups map VALUE as serialized in a file-history snapshot record.
type WireBackupEntry = { backupFileName?: string | null; backupTime?: string };

// A trackedFileBackups entry surfaced with its map key (the tracked file's relative path).
export type WireTrackedBackup = { relativePath: string; backupTime: string | undefined };

// One reconstructed file of the cached unified document (structurally matching the shape
// file-history.ts's findRevisionForChangeId expects; this file only reads timestamp).
type WireRevision = { changeId: string; timestamp: string };
export type WireFileHistory = { target: string; revisions: WireRevision[] };

// A resolved revision link: a reconstructed file, optionally anchored at one revision.
export type WireRevisionLink = { target: string; revisionNumber?: number };

// The /api/blob response shape.
export type WireBlobResponse = { exists?: boolean; content?: string };

// The per-transcript link maps computeLinkMaps builds.
export type LinkMaps = {
    uuidToLine: Map<string, number>;
    toolIdToLines: Map<string, number[]>;
};

// Per-transcript link maps, computed once per rawLines array: each record uuid -> its own
// line, and each toolu_… id -> every line whose text carries it (tool_use + tool_result).
const linkMapsCache = new WeakMap<string[], LinkMaps>();

export function computeLinkMaps(rawLines: string[]): LinkMaps {
    if (linkMapsCache.has(rawLines)) {
        return linkMapsCache.get(rawLines)!;
    }
    const uuidToLine = new Map<string, number>();
    const toolIdToLines = new Map<string, number[]>();
    rawLines.forEach((text, index) => {
        try {
            const uuid = (JSON.parse(text) as WireRecord).uuid;
            if (uuid !== undefined) uuidToLine.set(uuid, index);
        } catch { /* a non-JSON line simply has no uuid */ }
        for (const match of text.matchAll(/toolu_[A-Za-z0-9_]+/g)) {
            if (!toolIdToLines.has(match[0])) toolIdToLines.set(match[0], []);
            const lines = toolIdToLines.get(match[0])!;
            if (!lines.includes(index)) lines.push(index);
        }
    });
    const maps = { uuidToLine, toolIdToLines };
    linkMapsCache.set(rawLines, maps);
    return maps;
}

// The line a string value links to, or undefined: toolu ids link to their first OTHER
// carrier line; uuids link to the record they name (never the line being shown).
export function findJumpTarget(value: string, currentLine: number, maps: LinkMaps): number | undefined {
    if (value.startsWith("toolu_")) {
        return maps.toolIdToLines.get(value)?.find((line) => line !== currentLine);
    }
    const line = maps.uuidToLine.get(value);
    return line !== undefined && line !== currentLine ? line : undefined;
}

// The snapshot entry whose backupFileName is `blobName`, as { relativePath, backupTime } —
// the trackedFileBackups KEY is the tracked file's relative path, and the backupTime dates the
// file state the backup captured. undefined when the record is no file-history snapshot or
// tracks no such backup.
export function findTrackedBackupEntry(record: WireValue, blobName: string): WireTrackedBackup | undefined {
    const backups = (record as WireRecord | null)?.snapshot?.trackedFileBackups;
    if (backups === undefined) {
        return undefined;
    }
    for (const [relativePath, entry] of Object.entries(backups)) {
        if (entry.backupFileName === blobName) {
            return { relativePath, backupTime: entry.backupTime };
        }
    }
    return undefined;
}

// The backupTime of the snapshot entry whose backupFileName is `blobName`, or undefined when
// the record is no file-history snapshot or tracks no such backup. That time dates the file
// state the backup captured, so it resolves a blob version to a revision.
export function findBackupTimeForBlob(record: WireValue, blobName: string): string | undefined {
    return findTrackedBackupEntry(record, blobName)?.backupTime;
    // (item 23) body moved into findTrackedBackupEntry, which also surfaces the tracked path:
    // const backups = record?.snapshot?.trackedFileBackups;
    // if (backups === undefined) {
    //     return undefined;
    // }
    // for (const entry of Object.values(backups)) {
    //     if (entry.backupFileName === blobName) {
    //         return entry.backupTime;
    //     }
    // }
    // return undefined;
}

// The file-history anchor for a tracked backup: the document file whose target IS the tracked
// relative path (or ends with "/" + it), numbered at the last revision at or before the
// backupTime (ISO strings compare correctly — the computeContentAtTime convention), with
// revisionNumber undefined when the backup predates every revision. undefined when no
// reconstructed file matches (the caller omits its button).
export function computeSnapshotHistoryAnchor(
    filesTouched: WireFileHistory[], relativePath: string, backupTime: string | undefined,
): WireRevisionLink | undefined {
    const history = filesTouched.find(
        (entry) => entry.target === relativePath || entry.target.endsWith(`/${relativePath}`),
    );
    if (history === undefined) {
        return undefined;
    }
    let revisionNumber: number | undefined;
    history.revisions.forEach((revision, index) => {
        if (backupTime !== undefined && revision.timestamp <= backupTime) {
            revisionNumber = index + 1;
        }
    });
    return { target: history.target, revisionNumber };
}

// The /api/blob request URL for one (owning session, blob name) pair.
export function computeBlobRequestUrl(sessionId: string, blobName: string): string {
    return `/api/blob?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(blobName)}`;
}

// The file-history route a resolved revision link navigates to: anchored at /rev/<n> when the
// link names one revision, the file's plain history otherwise.
export function computeRevisionLinkRoute(project: string, { target, revisionNumber }: WireRevisionLink): string {
    const base = routeToFileHistory(project, target);
    return revisionNumber === undefined ? base : `${base}/rev/${revisionNumber}`;
}

// The tool_use identity of a shown record: its first tool_use block's id plus the record's own
// uuid; undefined when the record calls no tool.
function findToolUseIdentity(value: WireValue): { toolUseId: string | undefined; recordUuid: string | undefined } | undefined {
    if (value === null) {
        return undefined;
    }
    if (typeof value !== "object") {
        return undefined;
    }
    if (value.type !== "assistant") {
        return undefined;
    }
    const content = value.message?.content;
    if (!Array.isArray(content)) {
        return undefined;
    }
    const toolUse = content.find((block) => block.type === "tool_use");
    if (toolUse === undefined) {
        return undefined;
    }
    return { toolUseId: toolUse.id, recordUuid: value.uuid };
}

// The tool-flow jump targets of a shown record: the PreToolUse hook line (the FIRST record whose
// toolUseID names the tool_use id) and the tool-result line (sourceToolAssistantUUID names the
// assistant record; the tool_result block's tool_use_id is the fallback for older transcripts).
// Each is -1 when absent; undefined when the record calls no tool.
export function findToolNavigationTargets(rawLines: string[], value: WireValue): { hookLine: number; resultLine: number } | undefined {
    const toolUse = findToolUseIdentity(value);
    if (toolUse === undefined) {
        return undefined;
    }
    const hookLine = rawLines.findIndex((text) => text.includes(`"toolUseID":"${toolUse.toolUseId}"`));
    let resultLine = rawLines.findIndex((text) => text.includes(`"sourceToolAssistantUUID":"${toolUse.recordUuid}"`));
    if (resultLine < 0) {
        resultLine = rawLines.findIndex((text) => text.includes(`"tool_use_id":"${toolUse.toolUseId}"`));
    }
    return { hookLine, resultLine };
}
