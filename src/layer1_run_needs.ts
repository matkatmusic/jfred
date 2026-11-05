// Task 358 part NS: lists the earlier runs a run still needs, from saved results only; spawns nothing.

import type { WireNeededRun } from "../webapp/layer1-wire-script-results.ts";
import { findRunSkipReason } from "./layer1_run_skip.ts";
import { computeRunStartFiles, loadReplayRun, type LoadedRun, type RunInput } from "./layer1_run_start_files.ts";
import { findScriptExecutionRuns, formatRunSource, type ScriptRun } from "./reconstruction_script_execution.ts";
import { collectEarlierRuns, type EarlierRunReport } from "./reconstruction_script_sandbox_spawn_guard.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";

function isRunNeverReplayed(loaded: LoadedRun): boolean {
  const isErrored = collectErroredToolUseIds(loaded.records).has(String(loaded.run.toolUseId));
  const isSkipped = findRunSkipReason(loaded.run) !== undefined;
  return isErrored || isSkipped;
}

function findReportedRun(loaded: LoadedRun, report: EarlierRunReport): ScriptRun {
  for (const run of findScriptExecutionRuns(loaded.records)) {
    const isSameCode = run.code === report.script;
    const isSameSource = formatRunSource(run) === report.label;
    const isSameRun = isSameCode && isSameSource;
    if (isSameRun) {
      return run;
    }
  }
  throw new Error(`an earlier run in the report matches no run in the session:${report.label}`);
}

function createNeededRun(input: RunInput, run: ScriptRun, report: EarlierRunReport): WireNeededRun {
  const { toolUseId, source } = run;
  const isToolUseIdMissing = toolUseId === undefined;
  const isSourceMissing = source === undefined;
  const isRunUnidentified = isToolUseIdMissing || isSourceMissing;
  if (isRunUnidentified) {
    throw new Error(`the earlier run${report.label} has no tool_use id or no source line`);
  }
  return {
    toolUseId: toolUseId.toString(),
    sessionFile: input.sessionFile.toString(),
    line: source.lineNumber,
    instant: run.timestamp.toISOString(), state: report.state,
  };
}

function compareNeededRuns(left: WireNeededRun, right: WireNeededRun): number {
  const byInstant = Date.parse(left.instant) - Date.parse(right.instant);
  if (byInstant !== 0) {
    return byInstant;
  }
  const bySessionFile = left.sessionFile.localeCompare(right.sessionFile);
  if (bySessionFile !== 0) {
    return bySessionFile;
  }
  return left.line - right.line;
}

function listNeededRuns(input: RunInput, loaded: LoadedRun, reports: EarlierRunReport[]): WireNeededRun[] {
  const neededRuns: WireNeededRun[] = [];
  for (const report of reports) {
    const run = findReportedRun(loaded, report);
    const isTarget = run.toolUseId?.equals(input.toolUseId) === true;
    if (!isTarget) {
      neededRuns.push(createNeededRun(input, run, report));
    }
  }
  return neededRuns.sort(compareNeededRuns);
}

export function computeRunNeeds(input: RunInput): WireNeededRun[] {
  const loaded = loadReplayRun(input);
  const isNeverReplayed = isRunNeverReplayed(loaded);
  if (isNeverReplayed) {
    return [];
  }
  const startFiles = computeRunStartFiles(loaded, input.sources, collectEarlierRuns, input.repoPath);
  return listNeededRuns(input, loaded, startFiles.lineageResult);
}
