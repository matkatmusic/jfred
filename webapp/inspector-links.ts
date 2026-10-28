// Link/anchor model for the JSON inspector; rendering lives in inspector-json.ts, the pane in inspector.ts.

import { getFileHistoryRoute } from "./app-routes.ts";

// Parsed JSONL is dynamic, so these wire types name only the fields this file reads.

export type WireContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | WireContentBlock[];
};

export type WireRecord = {
  uuid?: string;
  type?: string;
  message?: { content?: string | WireContentBlock[] };
  snapshot?: { trackedFileBackups?: Record<string, WireBackupEntry> };
};

export type WireValue = WireRecord | string | null;

type WireBackupEntry = { backupFileName?: string | null; backupTime?: string };

// The map key is the tracked file's relative path.
export type WireTrackedBackup = { relativePath: string; backupTime: string | undefined };

// Structurally matches what file-history.ts's findRevisionForChangeId expects; only timestamp is read here.
type WireRevision = { changeId: string; timestamp: string };
export type WireFileHistory = { target: string; revisions: WireRevision[] };

export type WireRevisionLink = { target: string; revisionNumber?: number };

export type WireBlobResponse = { exists?: boolean; content?: string };

export type LinkMaps = {
  uuidToLine: Map<string, number>;
  toolIdToLines: Map<string, number[]>;
};

// Per-transcript link maps, computed once per rawLines array: each uuid and each toolu_… id map to their line(s).
const linkMapsCache = new WeakMap<string[], LinkMaps>();

export function computeLinkMaps(rawLines: string[]): LinkMaps {
  const cachedMaps = linkMapsCache.get(rawLines);
  if (cachedMaps !== undefined) {
    return cachedMaps;
  }
  const uuidToLine = new Map<string, number>();
  const toolIdToLines = new Map<string, number[]>();
  for (const [index, text] of rawLines.entries()) {
    try {
      const uuid = (JSON.parse(text) as WireRecord).uuid;
      if (uuid !== undefined)
        uuidToLine.set(uuid, index);
    }
    catch { /* a non-JSON line simply has no uuid */ }
    for (const match of text.matchAll(/toolu_[A-Za-z0-9_]+/g)) {
      const lines = toolIdToLines.get(match[0]) ?? [];
      toolIdToLines.set(match[0], lines);
      const hasLine = lines.includes(index);
      if (!hasLine)
        lines.push(index);
    }
  }
  const maps = { uuidToLine, toolIdToLines };
  linkMapsCache.set(rawLines, maps);
  return maps;
}

// A link never points at the line being shown.
export function findJumpTarget(value: string, currentLine: number, maps: LinkMaps): number | undefined {
  const isToolId = value.startsWith("toolu_");
  if (isToolId) {
    for (const line of maps.toolIdToLines.get(value) ?? []) {
      if (line !== currentLine)
        return line;
    }
    return undefined;
  }
  const line = maps.uuidToLine.get(value);
  return line !== undefined && line !== currentLine ? line : undefined;
}

// The trackedFileBackups KEY is the tracked file's relative path.
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

// The backupTime dates the file state the backup captured, so it resolves a blob version to a revision.
export function findBackupTimeForBlob(record: WireValue, blobName: string): string | undefined {
  return findTrackedBackupEntry(record, blobName)?.backupTime;
  // (item 23) body moved into findTrackedBackupEntry, which also surfaces the tracked path.
}

// ISO timestamp strings compare correctly, per the computeContentAtTime convention.
export function computeSnapshotHistoryAnchor(
  filesTouched: WireFileHistory[], relativePath: string, backupTime: string | undefined,
): WireRevisionLink | undefined {
  let history: WireFileHistory | undefined;
  for (const entry of filesTouched) {
    const endsWithPath = entry.target.endsWith(`/${relativePath}`);
    const isMatch = entry.target === relativePath || endsWithPath;
    if (isMatch) {
      history = entry;
      break;
    }
  }
  if (history === undefined) {
    return undefined;
  }
  let revisionNumber: number | undefined;
  for (const [index, revision] of history.revisions.entries()) {
    const isAtOrBeforeBackup = backupTime !== undefined && revision.timestamp <= backupTime;
    if (isAtOrBeforeBackup)
      revisionNumber = index + 1;
  }
  return { target: history.target, revisionNumber };
}

export function computeBlobRequestUrl(sessionId: string, blobName: string): string {
  return `/api/blob?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(blobName)}`;
}

export function computeRevisionLinkRoute(project: string, { target, revisionNumber }: WireRevisionLink): string {
  const base = getFileHistoryRoute(project, target);
  return revisionNumber === undefined ? base : `${base}/rev/${revisionNumber}`;
}
