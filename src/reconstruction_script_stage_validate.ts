// Script-execution replay: validates one user-edit beacon against a forward run of its script.

import { EventKind } from "./structures/vocabulary.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { beaconSnippetFor } from "./reconstruction_user_edit.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import {
  createScriptExecutionEvent,
  getImmediatePostExecutionState,
  getPostExecutionBeacon,
  matchLinesToBeacon,
} from "./reconstruction_script_stage_beacon.ts";
import type { ScriptExecutionEvent, ScriptRun } from "./reconstruction_script_execution.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";
import { findRefForTarget, findRunForTarget } from "./reconstruction_script_probe.ts";
import type { UserEditEvent } from "./reconstruction_events.ts";

// Validates a user-edit beacon by running its script; on match, returns a ScriptExecutionEvent.
export function findScriptExecutionForBeacon(
  beacon: UserEditEvent,
  runs: ScriptRun[],
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent?: LineageContentBefore,
): ScriptExecutionEvent | undefined {
  const run = findRunForTarget(runs, beacon.target, beacon.timestamp, records, reader, seedContent);
  if (run === undefined)
    return undefined;

  const execution = executeRunOnce(run, records, reader, seedContent);
  const preExecutionState = execution.pre;
  const resultingState = execution.post;
  if (resultingState === undefined)
    return undefined;

  const targetRef = findRefForTarget(beacon.target, [...preExecutionState.keys()]);
  if (targetRef === undefined)
    return undefined;

  const resultContent = resultingState.get(targetRef);
  if (resultContent === undefined)
    return undefined;

  // Guard: if the script didn't change this file, it's not a script-execution event
  const preContent = preExecutionState.get(targetRef);
  if (resultContent === preContent)
    return undefined;

  // VALIDATE: compare resultingState to expectedState Primary: full content match against beacon backup
  const beaconContent = getPostExecutionBeacon(beacon.target, beacon.timestamp, records, reader);
  if (beaconContent !== undefined) {
    const expectedState = getImmediatePostExecutionState(beaconContent);
    if (resultContent === expectedState) {
      return createScriptExecutionEvent(beacon, resultContent, run);
    }
  }
  // Fallback: windowed comparison (handles out-of-band changes between script and beacon)
  const snippet = beaconSnippetFor(records, beacon.changeId);
  if (snippet === undefined)
    return undefined;
  const isWindowMatch = matchLinesToBeacon(splitLines(resultContent), snippet);
  if (!isWindowMatch)
    return undefined;
  return {
    kind: EventKind.scriptExecution,
    changeId: beacon.changeId,
    target: beacon.target,
    content: resultContent,
    timestamp: run.timestamp,
  };
}
