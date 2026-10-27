// Task 313 (spec S19): /api/layer1-file's snapshot form — one @vN's bytes from its OWNING session.

import { resolve, sep } from "node:path";
import { collectSnapshotPlacements, type SnapshotPlacement } from "./layer1_snapshots.ts";
import { collectTitleRanges, titleInEffectAtLine } from "./layer1_sessions.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import { getRecordSource, loadTranscript } from "./parse/loadTranscript.ts";
import { createSidecarReader } from "./reconstruction_sidecar_backup_path.ts";
import { getFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getRequiredParam } from "./viewer_server_routes.ts";

// Trust boundary: a session id reaches the filesystem as a path segment, so refuse `.`, `/`, `\`.
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]+$/;

// @vN is numbered PER FILE within a session, so path — not version alone — disambiguates the blob.
function parseSnapshotVersion(raw: string): number {
  const version = Number(raw);
  const isInteger = Number.isInteger(version);
  const isNegative = version < 0;
  const isInvalid = !isInteger || isNegative;
  if (isInvalid) {
    throw new Error(`not a snapshot version: ${raw}`);
  }
  return version;
}

// The one placement matching this file + owning session + version; undefined when the session records none.
function findSnapshotPlacement(
  sessionFile: Path,
  projectFolder: Path,
  relativePath: string,
  owner: Uuid,
  version: number,
): SnapshotPlacement | undefined {
  for (const [absolutePath, placements] of collectSnapshotPlacements([sessionFile])) {
    const relativeOfPlacement = relativizeToProjectFolder(projectFolder, absolutePath);
    if (relativeOfPlacement !== relativePath) {
      continue;
    }
    for (const placement of placements) {
      const isOwner = placement.sessionId.toString() === owner.toString();
      const isVersion = placement.version === version;
      const isMatch = isOwner && isVersion;
      if (isMatch) {
        return placement;
      }
    }
  }
  return undefined;
}

// True when this query selects the snapshot form; the owning-session transcript path is its marker.
export function isSnapshotFileRequest(query: URLSearchParams): boolean {
  return query.get("snapshotSession") !== null;
}

// Task 317: the blob's bytes, plus the customTitle in effect at the snapshot's LINE (not first or last).
export function readSnapshotFileContent(query: URLSearchParams): { content: string; title: string; record: TranscriptRecord | undefined } {
  const sessionId = getRequiredParam(query, "sessionId");
  const isSessionId = SESSION_ID_PATTERN.test(sessionId);
  if (!isSessionId) {
    throw new Error(`not a session id: ${sessionId}`);
  }
  const owner = new Uuid(sessionId);
  const sessionFile = new Path(getRequiredParam(query, "snapshotSession"));
  const projectFolder = new Path(getRequiredParam(query, "dir"));
  const relativePath = getRequiredParam(query, "path");
  const version = parseSnapshotVersion(getRequiredParam(query, "version"));
  const placement = findSnapshotPlacement(sessionFile, projectFolder, relativePath, owner, version);
  if (placement === undefined) {
    throw new Error(`no snapshot ${relativePath}@v${version} in session ${sessionId}`);
  }
  const records = loadTranscript(sessionFile.toString(), undefined, true).records;
  const root = getFileHistoryRoot(records);
  // Defense in depth: the name is re-derived, but confirm the read never escapes this session's dir.
  const sessionDir = resolve(root.toString(), owner.toString());
  const backupPath = resolve(sessionDir, placement.backupFileName.toString());
  const isInsideSessionDir = backupPath.startsWith(sessionDir + sep);
  if (!isInsideSessionDir) {
    throw new Error(`snapshot escapes the file-history root: ${placement.backupFileName.toString()}`);
  }
  const content = createSidecarReader(owner, root)(placement.backupFileName);
  const title = titleInEffectAtLine(collectTitleRanges(records), placement.line ?? 0) ?? "untitled session";
  // Task 213: the snapshot-line record feeds the drawer [{ }] reveal, via toJSON.
  let record: TranscriptRecord | undefined;
  for (const entry of records) {
    const isSnapshotLine = getRecordSource(entry)?.lineNumber === placement.line;
    if (isSnapshotLine) {
      record = entry;
      break;
    }
  }
  return { content, title, record };
}
