// Link/anchor model for the JSON inspector: wire types over parsed JSONL lines,
// per-transcript link maps, snapshot/backup anchors, revision routes, and tool-flow
// navigation targets. Rendering lives in inspector-json.ts; the pane in inspector.ts.
import { routeToFileHistory } from "./app-routes.js";
// Per-transcript link maps, computed once per rawLines array: each record uuid -> its own
// line, and each toolu_… id -> every line whose text carries it (tool_use + tool_result).
const linkMapsCache = new WeakMap();
export function computeLinkMaps(rawLines) {
    if (linkMapsCache.has(rawLines)) {
        return linkMapsCache.get(rawLines);
    }
    const uuidToLine = new Map();
    const toolIdToLines = new Map();
    rawLines.forEach((text, index) => {
        try {
            const uuid = JSON.parse(text).uuid;
            if (uuid !== undefined)
                uuidToLine.set(uuid, index);
        }
        catch { /* a non-JSON line simply has no uuid */ }
        for (const match of text.matchAll(/toolu_[A-Za-z0-9_]+/g)) {
            if (!toolIdToLines.has(match[0]))
                toolIdToLines.set(match[0], []);
            const lines = toolIdToLines.get(match[0]);
            if (!lines.includes(index))
                lines.push(index);
        }
    });
    const maps = { uuidToLine, toolIdToLines };
    linkMapsCache.set(rawLines, maps);
    return maps;
}
// The line a string value links to, or undefined: toolu ids link to their first OTHER
// carrier line; uuids link to the record they name (never the line being shown).
export function findJumpTarget(value, currentLine, maps) {
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
export function findTrackedBackupEntry(record, blobName) {
    const backups = record?.snapshot?.trackedFileBackups;
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
export function findBackupTimeForBlob(record, blobName) {
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
export function computeSnapshotHistoryAnchor(filesTouched, relativePath, backupTime) {
    const history = filesTouched.find((entry) => entry.target === relativePath || entry.target.endsWith(`/${relativePath}`));
    if (history === undefined) {
        return undefined;
    }
    let revisionNumber;
    history.revisions.forEach((revision, index) => {
        if (backupTime !== undefined && revision.timestamp <= backupTime) {
            revisionNumber = index + 1;
        }
    });
    return { target: history.target, revisionNumber };
}
// The /api/blob request URL for one (owning session, blob name) pair.
export function computeBlobRequestUrl(sessionId, blobName) {
    return `/api/blob?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(blobName)}`;
}
// The file-history route a resolved revision link navigates to: anchored at /rev/<n> when the
// link names one revision, the file's plain history otherwise.
export function computeRevisionLinkRoute(project, { target, revisionNumber }) {
    const base = routeToFileHistory(project, target);
    return revisionNumber === undefined ? base : `${base}/rev/${revisionNumber}`;
}
// The tool_use identity of a shown record: its first tool_use block's id plus the record's own
// uuid; undefined when the record calls no tool.
function findToolUseIdentity(value) {
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
export function findToolNavigationTargets(rawLines, value) {
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
