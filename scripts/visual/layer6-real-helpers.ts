// Pure helpers of the Layer 6 real-data check: candidate order, outcome tallies, class maps and rect tests.

import { WireScriptLanguage } from "../../webapp/layer1-script-language.ts";
import { WireRunOutcome, WireRunStreamKind, type WireScriptResult } from "../../webapp/layer1-wire-script-results.ts";
import { type WireScriptRunsView } from "../../webapp/layer1-wire-script-runs.ts";

export type ScriptRun = WireScriptRunsView["pairs"][number]["scriptRuns"][number];
export interface ReplayAttempt { toolUseId: string; outcome: WireRunOutcome; ms: number; result: WireScriptResult }

export const MAX_CANDIDATES = 40;
export const REQUIRED_DIALOG_PHRASES = ["copied files only", "no network", "Docker container", "Docker must be on"];
export const FORBIDDEN_DIALOG_PHRASE = "full access";
const STATE_CLASS_PREFIX = "run-state-";
const ERROR_KIND = "error";

export function compareRunsByTime(first: ScriptRun, second: ScriptRun): number {
  const byInstant = Date.parse(first.instant) - Date.parse(second.instant);
  const bySession = first.sessionFile.localeCompare(second.sessionFile);
  return byInstant || bySession || (first.line ?? 0) - (second.line ?? 0);
}

function isPythonRun(run: ScriptRun): boolean {
  return run.language === WireScriptLanguage.python || run.language === WireScriptLanguage.python3;
}

// One entry per run (a run sits in several bubbles), python only, in time order.
export function listCandidateRuns(view: WireScriptRunsView): ScriptRun[] {
  const runsById = new Map<string, ScriptRun>();
  for (const pair of view.pairs) {
    for (const run of pair.scriptRuns) {
      const isPython = isPythonRun(run);
      if (isPython) {
        runsById.set(run.toolUseId, run);
      }
    }
  }
  return [...runsById.values()].sort(compareRunsByTime);
}

export function isAttempted(attempts: ReplayAttempt[], toolUseId: string): boolean {
  for (const attempt of attempts) {
    if (attempt.toolUseId === toolUseId) {
      return true;
    }
  }
  return false;
}

export function findReplayedAttempt(attempts: ReplayAttempt[]): ReplayAttempt | undefined {
  for (const attempt of attempts) {
    if (attempt.outcome === WireRunOutcome.replayed) {
      return attempt;
    }
  }
  return undefined;
}

export function formatOutcomeCounts(attempts: ReplayAttempt[]): string {
  const parts: string[] = [];
  for (const outcome of Object.values(WireRunOutcome)) {
    let count = 0;
    for (const attempt of attempts) {
      count += attempt.outcome === outcome ? 1 : 0;
    }
    parts.push(`${outcome}=${count}`);
  }
  return parts.join(", ");
}

export function isReplayWithoutFile(result: WireScriptResult): boolean {
  return result.outcome === WireRunOutcome.replayed && result.files.length === 0;
}

// The run NDJSON stream ends with one result line; an error line is a failure.
export function parseStreamResult(text: string): WireScriptResult {
  let result: WireScriptResult | undefined = undefined;
  for (const line of text.split("\n")) {
    const parsed = line.trim() === "" ? {} : JSON.parse(line) as { kind?: string; label?: string };
    if (parsed.kind === ERROR_KIND) {
      throw new Error(`run stream error: ${parsed.label}`);
    }
    result = parsed.kind === WireRunStreamKind.result ? parsed as WireScriptResult : result;
  }
  if (result === undefined) {
    throw new Error(`run stream had no result line: ${text.slice(0, 200)}`);
  }
  return result;
}

export function convertStateClassToTerminalClass(classNames: string): string | undefined {
  for (const name of classNames.split(/\s+/)) {
    const isStateClass = name.startsWith(STATE_CLASS_PREFIX);
    if (isStateClass) {
      return `term-${name.slice(STATE_CLASS_PREFIX.length)}`;
    }
  }
  return undefined;
}

export function isRectLeftOf(rightEdge: number, leftEdge: number): boolean {
  return rightEdge <= leftEdge;
}

export function findMissingPhrases(text: string, phrases: string[]): string[] {
  const missing: string[] = [];
  for (const phrase of phrases) {
    const isPresent = text.includes(phrase);
    if (!isPresent) {
      missing.push(phrase);
    }
  }
  return missing;
}

export function formatNeedsLine(toolUseId: string, needsSize: number, ms: number): string {
  return `needs ${toolUseId}: ${needsSize} earlier runs, ${ms} ms`;
}

export function formatRunLine(attempt: ReplayAttempt): string {
  return `run ${attempt.toolUseId}: ${attempt.outcome}, ${attempt.result.files.length} files, ${attempt.ms} ms`;
}
