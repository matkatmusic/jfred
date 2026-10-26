// Beacon comparison helpers for the script-execution stage in reconstruction_script_stage.ts.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BeaconSnippet } from "./reconstruction_user_edit.ts";
import { backupSeedWriteFor, type BackupReader } from "./reconstruction_sidecar.ts";
import type { ScriptExecutionEvent, ScriptRun } from "./reconstruction_script_execution.ts";
import type { UserEditEvent } from "./reconstruction_events.ts";

// True when `lines` matches every visible beacon line at its 1-based number. The beacon may be a window.
export function linesMatchBeacon(lines: string[], snippet: BeaconSnippet): boolean {
  for (const { lineNo, text } of snippet.lines) {
    if (lineNo - 1 >= lines.length || lines[lineNo - 1] !== text)
      return false;
  }
  return true;
}

// The full file content at the beacon's observation time — the post-execution anchor.
export function getPostExecutionBeacon(
  target: Path,
  beaconTimestamp: Date,
  records: TranscriptRecord[],
  reader: BackupReader,
): string | undefined {
  const backup = backupSeedWriteFor(records, target, beaconTimestamp, reader);
  return backup?.content;
}

// ponytail: identity — no scenarios have edits between script run and beacon; add rewind when needed
export function getImmediatePostExecutionState(beaconContent: string): string {
  return beaconContent;
}

// The synthetic script-execution event for a validated beacon: the beacon's identity with the computed content and the run's timestamp.
export function createScriptExecutionEvent(
  beacon: UserEditEvent,
  resultContent: string,
  run: ScriptRun,
): ScriptExecutionEvent {
  return {
    kind: EventKind.scriptExecution,
    changeId: beacon.changeId,
    target: beacon.target,
    content: resultContent,
    timestamp: run.timestamp,
  };
}
