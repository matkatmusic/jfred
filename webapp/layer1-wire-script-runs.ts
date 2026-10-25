// Layer 1's script-run node vocabulary on the wire (task 356).

import type { WireScriptLanguage } from "./layer1-script-language.ts";
import type { WireInstantOf } from "./layer1-wire.ts";

// Wire spelling of ScriptExecutorKind (src/reconstruction_script_execution.ts) — drives the never-provable idiom.
export const WireScriptExecutorKind = {
  python: "python",
  bash: "bash",
} as const;
export type WireScriptExecutorKind = (typeof WireScriptExecutorKind)[keyof typeof WireScriptExecutorKind];

// Replaced by describeScriptLanguage (layer1-script-language.ts), the one label source: export const WireScriptExecutorIcon = { python: "python run", bash: "$" } as const satisfies Record<WireScriptExecutorKind, string>;

// Task 356: a script-run node; identity is scriptRun:<toolUseId> — one shared drawer across every bubble it touches.
export interface WireScriptRunOf<I, P, U> extends WireInstantOf<I> {
  toolUseId: U;
  executorKind: WireScriptExecutorKind;
  language: WireScriptLanguage;
  line?: number; // The tool_use record's source line in sessionFile; absent when the engine kept no record source.
  // The resolved body (resolveScriptIndirection already ran engine-side) — the client never re-resolves it.
  code: string;
  // Absent when the engine's static scan named no file for this pair; the node still renders, unlabeled.
  label?: string;
  sessionId: U;
  sessionFile: P;
}

// Task 356: /api/layer1-script-runs answers without axisPx, as /api/layer1-edits does.
export interface WireScriptRunsViewOf<I, P, U> {
  pairs: { path: P; scriptRuns: Omit<WireScriptRunOf<I, P, U>, "axisPx">[] }[];
}

export type WireScriptRun = WireScriptRunOf<string, string, string>;
export type WireScriptRunsView = WireScriptRunsViewOf<string, string, string>;
