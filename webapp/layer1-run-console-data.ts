// L6 run console data: button states, terminal blocks, and the rules that pick one of each.

import { WireConfidence } from "./layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptResult } from "./layer1-wire-script-results.ts";

// export const RUN_CONSOLE_OUTPUT_LINES: readonly string[] = [
//   "$ python3 migrate_users.py --batch 200",
//   "Loading schema v14...",
//   "Connected to shard 3 of 6",
//   "Processing batch 1/40 (200 rows)",
//   "  200 rows OK, 0 skipped",
//   "Processing batch 2/40 (200 rows)",
//   "  200 rows OK, 0 skipped",
//   "Processing batch 3/40 (200 rows)",
//   "  198 rows OK, 2 skipped (duplicate key)",
//   "Processing batch 4/40 (200 rows)",
//   "Processing batch 5/40",
// ];

// export const RUN_CONSOLE_STREAMING_CAPTION =
//   "In the real console this block grows line by line as the script prints to stdout; here it is " +
//   "a fixed snapshot of output already streamed, not an animation.";

export const RUN_CONSOLE_OUTPUT_NOT_SAVED = "Output was not saved for this run. Clear saved results to run it again.";
export const RUN_CONSOLE_NO_PROOF_NOTE = "Replayed. No proof file was found to compare with.";

export interface RunConsoleCancelState {
  readonly key: string;
  readonly label: string;
  readonly className: string;
  readonly disabled: boolean;
}

export const RUN_CONSOLE_CANCEL_STATES: readonly RunConsoleCancelState[] = [
  { key: "idle", label: "Cancel", className: "btn-idle", disabled: true },
  { key: "running-cancelable", label: "Cancel", className: "btn-live", disabled: false },
  { key: "cancelled", label: "Cancelled", className: "btn-cancelled", disabled: true },
];

export interface RunConsoleTerminalState {
  readonly key: string;
  readonly label: string;
  readonly className: string;
  readonly description: string;
}

export const RUN_CONSOLE_TERMINAL_STATES: readonly RunConsoleTerminalState[] = [
  {
    key: "cancelled",
    label: "Cancelled",
    className: "term-cancelled",
    description: "Run stopped by the user before it produced a result.",
  },
  {
    key: "verified",
    label: "Verified",
    className: "term-verified",
    description: "Replay output matches the expected post-run state.",
  },
  {
    key: "mismatch",
    label: "Mismatch",
    className: "term-mismatch",
    description: "Replay output differs from the expected post-run state.",
  },
  {
    key: "original-failed",
    label: "Original run failed",
    className: "term-original-failed",
    description: "The recorded run itself errored; it was never replayed.",
  },
];

export function findRunConsoleCancelState(key: string): RunConsoleCancelState {
  for (const state of RUN_CONSOLE_CANCEL_STATES) {
    const isMatch = state.key === key;
    if (isMatch) {
      return state;
    }
  }
  throw new Error(`no run console cancel state: ${key}`);
}

export function findRunConsoleTerminalState(key: string | undefined): RunConsoleTerminalState | undefined {
  for (const state of RUN_CONSOLE_TERMINAL_STATES) {
    const isMatch = state.key === key;
    if (isMatch) {
      return state;
    }
  }
  return undefined;
}

export function selectRunConsoleCancelKey(isCancelled: boolean, isRunning: boolean): string {
  if (isCancelled) {
    return "cancelled";
  }
  return isRunning ? "running-cancelable" : "idle";
}

// A page cancel wins; failed, skipped, and unverified replays have no block.
export function selectRunConsoleTerminalKey(isCancelled: boolean, result: WireScriptResult | undefined): string | undefined {
  if (isCancelled) {
    return "cancelled";
  }
  if (result === undefined) {
    return undefined;
  }
  if (result.outcome === WireRunOutcome.originalFailed) {
    return WireConfidence.originalFailed;
  }
  const isUnverified = result.confidence === WireConfidence.injectedUnverified;
  return result.outcome === WireRunOutcome.replayed && !isUnverified ? result.confidence : undefined;
}

function listOutcomeNotes(result: WireScriptResult): string[] {
  const notes: string[] = [];
  const isReasonShown = result.outcome === WireRunOutcome.replayFailed || result.outcome === WireRunOutcome.notReplayed;
  if (isReasonShown) {
    notes.push(result.reason ?? result.outcome);
  }
  const isUnproven = result.outcome === WireRunOutcome.replayed && result.confidence === WireConfidence.injectedUnverified;
  if (isUnproven) {
    notes.push(RUN_CONSOLE_NO_PROOF_NOTE);
  }
  return notes;
}

export function listRunConsoleNotes(result: WireScriptResult | undefined): string[] {
  if (result === undefined) {
    return [];
  }
  const notes = listOutcomeNotes(result);
  if (!result.isOutputSaved) {
    notes.push(RUN_CONSOLE_OUTPUT_NOT_SAVED);
  }
  return notes;
}
