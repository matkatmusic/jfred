// Layer 1's real script-run wire contract (task 358, part W): run request, NDJSON stream lines, result, and needs route.

import type { WireConfidence } from "./layer1-wire-edits.ts";

export const WireRunOutcome = {
  replayed: "replayed",
  originalFailed: "original-failed",
  replayFailed: "replay-failed",
  notReplayed: "not-replayed",
} as const;
export type WireRunOutcome = (typeof WireRunOutcome)[keyof typeof WireRunOutcome];

// What a replay did to one file; only a changed text file has a rating.
export const WireFileChange = {
  changed: "changed",
  deleted: "deleted",
  changedNotText: "changed-not-text",
} as const;
export type WireFileChange = (typeof WireFileChange)[keyof typeof WireFileChange];

// Progress and error lines keep their existing spellings.
export const WireRunStreamKind = {
  output: "script-output",
  result: "script-result",
} as const;
export type WireRunStreamKind = (typeof WireRunStreamKind)[keyof typeof WireRunStreamKind];

export interface WireScriptRunRequest {
  sessionFile: string;
  toolUseId: string;
  allowScripts: boolean;
}

export interface WireScriptOutputLine {
  kind: typeof WireRunStreamKind.output;
  stream: "stdout" | "stderr";
  text: string;
}

export interface WireScriptResultOf<P, U> {
  kind: typeof WireRunStreamKind.result;
  toolUseId: U;
  outcome: WireRunOutcome;
  reason?: string;
  // Worst of the files; absent for replayFailed and notReplayed.
  confidence?: WireConfidence;
  // Project-relative; one entry per file the run changed. confidence is present only when change is "changed".
  files: { path: P; change: WireFileChange; confidence?: WireConfidence }[];
  stdout: string;
  stderr: string;
  exitCode?: number;
  timedOut: boolean;
  // False for a memo entry written before this task.
  isOutputSaved: boolean;
}

// "replay-failed" = crashed or timed out; cancelled is page-only.
export const WireNeedState = {
  unreplayed: "unreplayed",
  replayFailed: "replay-failed",
} as const;
export type WireNeedState = (typeof WireNeedState)[keyof typeof WireNeedState];

export interface WireScriptNeedsRequest {
  sessionFile: string;
  toolUseId: string;
}

export interface WireNeededRunOf<U> {
  toolUseId: U;
  sessionFile: string;
  line: number;
  // ISO string.
  instant: string;
  state: WireNeedState;
}

export type WireScriptResult = WireScriptResultOf<string, string>;
export type WireNeededRun = WireNeededRunOf<string>;

// Sorted by instant, sessionFile, line; empty means the run may start.
export interface WireScriptNeedsReply {
  toolUseId: string;
  needs: WireNeededRun[];
}
