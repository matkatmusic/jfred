// The on-disk side of the file-history sidecar: history roots, root resolution, and the blob reader.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { getPathOverrides, type SourceEntry } from "./reconstruction_overrides.ts";
import { getRecordSource, type RecordSource } from "./parse/loadTranscript.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { collectSessionIds, findMatchingSourceEntry } from "./reconstruction_sidecar_lookups.ts";

// Claude Code's default file-history root: ~/.claude/file-history.
export function getDefaultFileHistoryRoot(): Path {
  return new Path(join(homedir(), ".claude", "file-history"));
}

// The file-history dir next to a projects folder (<X>/projects → <X>/file-history), or undefined if absent.
export function findSiblingFileHistoryRoot(projectsDir: Path): Path | undefined {
  const sibling = join(dirname(projectsDir.toString()), "file-history");
  const siblingExists = existsSync(sibling);
  if (!siblingExists) {
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

// The file-history dir beside the transcript's projects folder, or undefined when no source or sibling exists.
export function findFileHistoryRootFromRecords(records: TranscriptRecord[]): Path | undefined {
  const source = findFirstRecordSource(records);
  if (source === undefined) {
    return undefined;
  }
  const transcriptDir = dirname(source.filePath);
  const projectsRoot = dirname(transcriptDir);
  return findSiblingFileHistoryRoot(new Path(projectsRoot));
}

// The file-history root resolution chain (item 46): explicit override → transcript-derived sibling → ~/.claude/file-history default.
export function getFileHistoryRoot(records: TranscriptRecord[]): Path {
  const override = getPathOverrides().fileHistoryRoot;
  if (override) {
    return override;
  }
  const derived = findFileHistoryRootFromRecords(records);
  if (derived) {
    return derived;
  }
  return getDefaultFileHistoryRoot();
}

// The first session id found in the records; file-history-snapshot records carry none.
export function findSessionId(records: TranscriptRecord[]): Uuid | undefined {
  for (const record of records) {
    const sessionId = (record as { sessionId?: Uuid }).sessionId;
    if (sessionId) {
      return sessionId;
    }
  }
  return undefined;
}

// The history root for one record: declared source dir, else transcript sibling, else default.
function getSourceFileHistoryRoot(recordSource: RecordSource, sources: SourceEntry[]): string {
  const projectsRoot = dirname(dirname(recordSource.filePath));
  const matchedSource = findMatchingSourceEntry(sources, projectsRoot);
  const explicitDir = matchedSource?.fileHistoryDir?.toString();
  const siblingDir = findSiblingFileHistoryRoot(new Path(projectsRoot))?.toString();
  return explicitDir ?? siblingDir ?? getDefaultFileHistoryRoot().toString();
}

// Per-session history roots for multi-source records, keyed by session id string.
function computeSessionFileHistoryRoots(records: TranscriptRecord[], sources: SourceEntry[]): Map<string, string> {
  const sessionRoots = new Map<string, string>();
  for (const record of records) {
    const sessionId = (record as { sessionId?: Uuid }).sessionId;
    if (!sessionId) {
      continue;
    }
    const sessionKey = sessionId.toString();
    const isKnownSession = sessionRoots.has(sessionKey);
    if (isKnownSession) {
      continue;
    }
    const source = getRecordSource(record);
    if (!source) {
      continue;
    }
    sessionRoots.set(sessionKey, getSourceFileHistoryRoot(source, sources));
  }
  return sessionRoots;
}

// The first session whose file-history dir holds the named backup, or undefined when none does.
function findBackupOwner(sessionIds: Uuid[], root: string, name: string): Uuid | undefined {
  for (const id of sessionIds) {
    const hasBackup = existsSync(join(root, id.toString(), name));
    if (hasBackup) {
      return id;
    }
  }
  return undefined;
}

// The file-history reader across every session dir the records reference; undefined when no session id exists.
export function buildSidecarReader(records: TranscriptRecord[], sources?: SourceEntry[]): BackupReader | undefined {
  const sessionIds = collectSessionIds(records);
  if (sessionIds.length === 0) {
    return undefined;
  }
  // item 46: const root = getDefaultFileHistoryRoot().toString();
  const root = getFileHistoryRoot(records).toString();
  // With declared sources, each session reads from its own source root.
  const sessionRoots = sources === undefined ? undefined : computeSessionFileHistoryRoots(records, sources);
  // Blob reads are lazy, so a hang after this line belongs to the next stage.
  reportReconstructionProgress(`sidecar reader ready: ${sessionIds.length} session(s), root ${root}`);
  return (backupFileName, sessionId) => {
    const name = backupFileName.toString();
    // Read the owning session's copy, since merged sessions reuse `@vN` names; search only if unknown.
    const owner = sessionId ?? findBackupOwner(sessionIds, root, name);
    const ownerRoot = sessionRoots?.get((owner ?? sessionIds[0]!).toString()) ?? root;
    return readFileSync(join(ownerRoot, (owner ?? sessionIds[0]!).toString(), name), "utf8");
  };
}

