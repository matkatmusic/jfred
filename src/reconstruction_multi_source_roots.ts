// Multi-source per-session workspace-root resolution (§b).

import { dirname } from "node:path";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { getRecordSource } from "./parse/loadTranscript.ts";
import { findMatchingSourceEntry } from "./reconstruction_sidecar_reader.ts";
import { sessionIdOf } from "./reconstruction_multi_source_join.ts";

// §b1: source's projects root is dirname(dirname(jsonl path)).
export function findDeclaredRootForRecord(record: TranscriptRecord, sources: SourceEntry[]): Path | undefined {
  const recordSource = getRecordSource(record);
  if (recordSource === undefined) {
    return undefined;
  }
  const projectsRoot = dirname(dirname(recordSource.filePath));
  return findMatchingSourceEntry(sources, projectsRoot)?.root;
}

// §b: session workspace root: declared source root (config wins, §b3), else first recorded cwd (§b2), keyed by sessionId.
export function computeSessionRoots(records: TranscriptRecord[], sources: SourceEntry[]): Map<string, Path> {
  const declaredRoots = new Map<string, Path>();
  const fallbackCwds = new Map<string, Path>();
  for (const record of records) {
    const sessionId = sessionIdOf(record);
    if (sessionId === undefined) {
      continue;
    }
    const sessionKey = sessionId.toString();
    if (!declaredRoots.has(sessionKey)) {
      const declaredRoot = findDeclaredRootForRecord(record, sources);
      if (declaredRoot !== undefined) {
        declaredRoots.set(sessionKey, declaredRoot);
      }
    }
    if (!fallbackCwds.has(sessionKey) && record.cwd !== undefined) {
      fallbackCwds.set(sessionKey, record.cwd);
    }
  }
  const roots = new Map<string, Path>(fallbackCwds);
  for (const [sessionKey, declaredRoot] of declaredRoots) {
    roots.set(sessionKey, declaredRoot);
  }
  return roots;
}
