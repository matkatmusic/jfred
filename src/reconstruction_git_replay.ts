// Script-run replay helpers for git-evidence placement, split from reconstruction_git_placement.ts.

import { EventKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";
import type { ScriptExecutionEvent, ScriptRun } from "./reconstruction_script_execution.ts";
import { computeScriptStateKey } from "./reconstruction_script_prestate.ts";
import { executeScriptAgainstState } from "./reconstruction_script_sandbox.ts";
import type { FileEvent, OverwriteEvent, UserEditEvent, WriteEvent } from "./reconstruction_events.ts";

// A lineage event carrying the file's FULL content at its instant (not a hunk-based edit).
export type FullContentEvent = WriteEvent | OverwriteEvent | UserEditEvent | ScriptExecutionEvent;

export function isFullContentEvent(event: FileEvent): event is FullContentEvent {
  return event.kind === EventKind.write
        || event.kind === EventKind.overwrite
        || event.kind === EventKind.userEdit
        || event.kind === EventKind.scriptExecution;
}

// Indices of full-content events at or before the evidence instant.
export function findFullContentIndices(events: FileEvent[], evidenceInstant: Date): number[] {
  const evidenceTime = evidenceInstant.getTime();
  const indices: number[] = [];
  for (const [index, event] of events.entries()) {
    const isAtOrBefore = event.timestamp.getTime() <= evidenceTime;
    const isFullContent = isFullContentEvent(event);
    const isCandidate = isAtOrBefore && isFullContent;
    if (isCandidate)
      indices.push(index);
  }
  return indices;
}

// Find the run whose timestamp matches this event's instant.
export function findRunAtInstant(runs: ScriptRun[], event: FileEvent): ScriptRun | undefined {
  const eventTime = event.timestamp.getTime();
  for (const run of runs) {
    const runTime = run.timestamp.getTime();
    if (runTime === eventTime)
      return run;
  }
  return undefined;
}

// Replay content through successive script runs, returning final and per-event results.
export function applyScriptRunsOver(
  content: string,
  eventIndices: number[],
  events: FileEvent[],
  runs: ScriptRun[],
  target: Path,
  records: TranscriptRecord[],
  reader: BackupReader,
): { final: string; rewrites: Map<number, string> } | undefined {
  let rolling = content;
  const rewrites = new Map<number, string>();
  for (const index of eventIndices) {
    const event = events[index]!;
    if (event.kind !== EventKind.scriptExecution)
      return undefined;
    const run = findRunAtInstant(runs, event);
    if (run === undefined)
      return undefined;
    const key = computeScriptStateKey(target, run.cwd);
    const preState = new Map(executeRunOnce(run, records, reader).pre);
    preState.set(key, rolling);
    const postState = executeScriptAgainstState(run.code, preState, "", run.cwd);
    const post = postState?.get(key);
    if (post === undefined)
      return undefined;
    rewrites.set(index, post);
    rolling = post;
  }
  return { final: rolling, rewrites };
}

// Timestamp halfway between event[index] and its successor.
export function computeMidpointAfter(events: FileEvent[], index: number, fallbackEnd: Date): Date {
  const start = events[index]!.timestamp.getTime();
  const end = index + 1 < events.length ? events[index + 1]!.timestamp.getTime() : fallbackEnd.getTime();
  return new Date(Math.floor((start + end) / 2));
}
