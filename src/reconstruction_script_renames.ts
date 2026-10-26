// No tool_use event marks a script rename; this module parses the printed `old -> new` line into rename events.

import { getContentBlocks } from "./structures/content-blocks.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";
import type { Path } from "./structures/domain.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import { isJunkStateKey } from "./reconstruction_script_sandbox.ts";
import {
  collectExecutorAndWrittenBasename,
  collectRenameCandidatesFromCompletedRunCode,
  collectRenameCandidatesFromToolResult,
  filterRenameCandidatesInTimestampOrder,
  type ExecutorRun,
  type RenameCandidate,
} from "./reconstruction_script_rename_candidates.ts";

// A shutil.move reports both sides as changed paths, but it is ONE move.
export type ScriptRenameKeyPair = { fromKey: string; toKey: string };

// Junk keys never pair, and a key present in both states is a modification, never a rename side.
export function matchRenamePairs(pre: Map<string, string>, post: Map<string, string>): ScriptRenameKeyPair[] {
  const deletedKeys: string[] = [];
  for (const key of pre.keys()) {
    if (post.has(key) || isJunkStateKey(key))
      continue;
    deletedKeys.push(key);
  }
  const pairs: ScriptRenameKeyPair[] = [];
  const claimedSourceKeys = new Set<string>();
  for (const key of post.keys()) {
    if (pre.has(key) || isJunkStateKey(key))
      continue;
    const sourceKey = deletedKeys.find((deleted) => !claimedSourceKeys.has(deleted) && pre.get(deleted) === post.get(key));
    if (sourceKey === undefined)
      continue;
    claimedSourceKeys.add(sourceKey);
    pairs.push({ fromKey: sourceKey, toKey: key });
  }
  return pairs;
}

export function extractScriptRenameEvents(records: TranscriptRecord[]): FileEvent[] {
  // MCP carries input.cwd/input.code; Bash uses the record cwd.
  const executors = new Map<string, ExecutorRun>();
  // Phantom guard: a rename source must be a basename some Write/Edit targeted.
  const writtenBasenames = new Set<string>();
  const erroredIds = collectErroredToolUseIds(records);
  for (const record of records) {
    const timestamp = record.timestamp;
    const recordCwd = (record as { cwd?: Path }).cwd;
    for (const block of getContentBlocks(record)) {
      collectExecutorAndWrittenBasename(block, timestamp, recordCwd, executors, writtenBasenames, erroredIds);
    }
  }
  const completionInstantByExecutorId = new Map<string, Date>();
  const candidates: RenameCandidate[] = [];
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      collectRenameCandidatesFromToolResult(block, record, executors, completionInstantByExecutorId, candidates);
    }
  }
  for (const executor of executors.values()) {
    collectRenameCandidatesFromCompletedRunCode(executor, completionInstantByExecutorId, candidates);
  }
  return filterRenameCandidatesInTimestampOrder(candidates, writtenBasenames);
}
