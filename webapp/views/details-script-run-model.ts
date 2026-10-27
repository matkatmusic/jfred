// DOM-free view model (task 67): maps a script run's changed paths to the revisions that show its diffs.

import { SCRIPT_RUN_CHANGE_ID_PREFIX } from "./timeline-changes.ts";
import type { WireFileHistory, WireScriptRun, WireTimelineDocument } from "./timeline-wire-types.ts";

// One changed file for the right pane; target and revisionNumber are undefined when no history tracks the path.
export type ScriptRunFileEntry = { path: string; target: string | undefined; revisionNumber: number | undefined };
export type ScriptRunDetailsViewModel = { code: string; files: ScriptRunFileEntry[] };

export function buildScriptRunDetailsViewModel(
  scriptRun: WireScriptRun,
  document: WireTimelineDocument,
): ScriptRunDetailsViewModel {
  const files: ScriptRunFileEntry[] = [];
  for (const path of scriptRun.changedPaths) {
    files.push(computeChangedFileEntry(path, scriptRun, document.filesTouched));
  }
  return { code: scriptRun.code, files };
}

// Mirrors the engine's findRefForTarget join: exact match, else a trailing path segment match.
function findMatchingHistory(path: string, histories: WireFileHistory[]): WireFileHistory | undefined {
  for (const candidate of histories) {
    const isExactTarget = candidate.target === path;
    const isTargetSuffix = candidate.target.endsWith(`/${path}`);
    const isPathSuffix = path.endsWith(`/${candidate.target}`);
    const isMatch = isExactTarget || isTargetSuffix || isPathSuffix;
    if (isMatch) {
      return candidate;
    }
  }
  return undefined;
}

function computeChangedFileEntry(path: string, scriptRun: WireScriptRun, histories: WireFileHistory[]): ScriptRunFileEntry {
  const history = findMatchingHistory(path, histories);
  if (history === undefined) {
    return { path, target: undefined, revisionNumber: undefined };
  }
  return { path, target: history.target, revisionNumber: selectRunRevisionNumber(history, scriptRun) };
}

// The 1-based revision showing this run's effect: its stamped changeId, else first at or after the run, else last.
function selectRunRevisionNumber(history: WireFileHistory, scriptRun: WireScriptRun): number {
  const runPrefix = `${SCRIPT_RUN_CHANGE_ID_PREFIX}${scriptRun.toolUseId}:`;
  for (const [index, revision] of history.revisions.entries()) {
    const isStamped = revision.changeId.startsWith(runPrefix);
    if (isStamped) {
      return index + 1;
    }
  }
  for (const [index, revision] of history.revisions.entries()) {
    const isAtOrAfterRun = revision.timestamp >= scriptRun.timestamp;
    if (isAtOrAfterRun) {
      return index + 1;
    }
  }
  return history.revisions.length;
}
