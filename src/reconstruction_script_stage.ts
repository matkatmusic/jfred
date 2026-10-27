// Script-execution replay stage: runs each script on its pre-state and compares to the beacon.

import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import {
  findScriptExecutionRuns,
  type ScriptExecutionEvent,
  type ScriptRun,
} from "./reconstruction_script_execution.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import { selectRunsWithinReplayWindow } from "./reconstruction_script_runs.ts";
import { findScriptExecutionForBeacon } from "./reconstruction_script_stage_validate.ts";
import { findBeaconlessScriptExecutions } from "./reconstruction_script_beaconless.ts";
import type { FileEvent } from "./reconstruction_events.ts";

function logInjection(event: ScriptExecutionEvent, detail: string): void {
  noteStage({
    stage: "injectScriptExecutions",
    target: event.target,
    changeId: event.changeId,
    detail,
    when: event.timestamp,
  });
}

function buildReplacementEvent(
  event: FileEvent,
  runs: ScriptRun[],
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent?: LineageContentBefore,
): FileEvent {
  if (event.kind !== EventKind.userEdit)
    return event;
  const replacement = findScriptExecutionForBeacon(event, runs, records, reader, seedContent);
  if (replacement === undefined)
    return event;
  logInjection(replacement, "replaced a script-echo user-edit beacon with the validated forward transform");
  return replacement;
}

// The first index whose event is later than `when`, or -1 when none is.
function findInsertionIndex(events: FileEvent[], when: Date): number {
  for (let index = 0; index < events.length; index++) {
    const isLater = events[index]!.timestamp > when;
    if (isLater)
      return index;
  }
  return -1;
}

export function formatScriptStageLabel(windowedCount: number, totalCount: number, target?: Path): string {
  const targetSuffix = target === undefined ? "" : ` for ${target}`;
  return `script stage: ${windowedCount} of ${totalCount} runs${targetSuffix}`;
}

// Replaces validated script-echo beacons with ScriptExecutionEvents, and injects events for beaconless edits.
export function applyScriptExecutions(
  records: TranscriptRecord[],
  events: FileEvent[],
  reader: BackupReader,
  target?: Path,
  seedContent?: LineageContentBefore,
): FileEvent[] {
  const isExecutionAllowed = isImpureExecutionAllowed();
  if (!isExecutionAllowed)
    return events;
  const allRuns = findScriptExecutionRuns(records);
  const runs = selectRunsWithinReplayWindow(allRuns);
  if (runs.length === 0)
    return events;
  reportReconstructionProgress(formatScriptStageLabel(runs.length, allRuns.length, target));
  let anyReplaced = false;
  const result: FileEvent[] = [];
  for (const event of events) {
    const rebuilt = buildReplacementEvent(event, runs, records, reader, seedContent);
    if (rebuilt !== event)
      anyReplaced = true;
    result.push(rebuilt);
  }
  const hasNoInjectionTarget = anyReplaced || target === undefined;
  if (hasNoInjectionTarget)
    return result;
  for (const injection of findBeaconlessScriptExecutions(target, runs, records, reader, seedContent)) {
    logInjection(injection, "injected script-execution effect for a file with no user-edit beacon");
    const insertAt = findInsertionIndex(result, injection.timestamp);
    if (insertAt < 0)
      result.push(injection);
    else
      result.splice(insertAt, 0, injection);
  }
  return result;
}
