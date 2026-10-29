// Pure lookups for the sidecar reader: distinct session ids and declared sources.

import { resolve } from "node:path";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";

// The distinct session ids across the records, in first-seen order.
export function collectSessionIds(records: TranscriptRecord[]): Uuid[] {
  const seen = new Set<string>();
  const ids: Uuid[] = [];
  for (const record of records) {
    const sessionId = (record as { sessionId?: Uuid }).sessionId;
    if (!sessionId)
      continue;
    const key = sessionId.toString();
    const isNewSession = !seen.has(key);
    if (isNewSession) {
      seen.add(key);
      ids.push(sessionId);
    }
  }
  return ids;
}

// The source entry whose projectsDir equals the given projects root, or undefined.
export function findMatchingSourceEntry(sources: SourceEntry[], projectsRoot: string): SourceEntry | undefined {
  const wantedRoot = resolve(projectsRoot);
  for (const source of sources) {
    const sourceRoot = resolve(source.projectsDir.toString());
    if (sourceRoot === wantedRoot) {
      return source;
    }
  }
  return undefined;
}
