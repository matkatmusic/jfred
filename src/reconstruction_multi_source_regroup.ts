// Regroup a flat merged stream into per-session lists.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getSessionId } from "./reconstruction_multi_source_paths.ts";

function selectGroupForUnsessionedRecord(groups: TranscriptRecord[][], currentGroup: TranscriptRecord[] | undefined): TranscriptRecord[] {
  if (currentGroup !== undefined) {
    return currentGroup;
  }
  const leadingGroup: TranscriptRecord[] = [];
  groups.push(leadingGroup);
  return leadingGroup;
}

function selectGroupForSession(sessionKey: string, groups: TranscriptRecord[][], groupBySession: Map<string, TranscriptRecord[]>): TranscriptRecord[] {
  const existingGroup = groupBySession.get(sessionKey);
  if (existingGroup !== undefined) {
    return existingGroup;
  }
  const newGroup: TranscriptRecord[] = [];
  groupBySession.set(sessionKey, newGroup);
  groups.push(newGroup);
  return newGroup;
}

// Unstamped records stay glued to their neighbor's session group.
function selectGroupForRecord(
  record: TranscriptRecord,
  groups: TranscriptRecord[][],
  groupBySession: Map<string, TranscriptRecord[]>,
  currentGroup: TranscriptRecord[] | undefined,
): TranscriptRecord[] {
  const sessionId = getSessionId(record);
  if (sessionId === undefined) {
    return selectGroupForUnsessionedRecord(groups, currentGroup);
  }
  return selectGroupForSession(sessionId.toString(), groups, groupBySession);
}

// A flat merged stream regrouped into per-session lists (first-seen order).
export function splitRecordsBySession(records: TranscriptRecord[]): TranscriptRecord[][] {
  const groups: TranscriptRecord[][] = [];
  const groupBySession = new Map<string, TranscriptRecord[]>();
  let currentGroup: TranscriptRecord[] | undefined;
  for (const record of records) {
    currentGroup = selectGroupForRecord(record, groups, groupBySession, currentGroup);
    currentGroup.push(record);
  }
  return groups;
}
