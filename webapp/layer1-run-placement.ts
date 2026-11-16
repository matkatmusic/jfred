// Places each script run's dots from its stored replay result at draw time; the input view is never changed.

import { getRunResult } from "./layer1-run-results.ts";
import { WireRunOutcome, type WireScriptResult } from "./layer1-wire-script-results.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";
import { isScriptRunsLoaded, listReplayedRunsOnNoViewPair, listRunsOnNoViewPair, type RunOnNoViewPair } from "./layer1-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

type ResultFile = WireScriptResult["files"][number];
type ViewPair = WireLayer1View["pairs"][number];
type ViewOrphan = WireLayer1View["diskOrphans"][number];
type RunRow = { path: string; scriptRuns?: WireScriptRun[] };

function collectFirstRunById(view: WireLayer1View): Map<string, WireScriptRun> {
  const runsById = new Map<string, WireScriptRun>();
  for (const pair of view.pairs) {
    for (const run of pair.scriptRuns ?? []) {
      const isSeen = runsById.has(run.toolUseId);
      if (!isSeen) {
        runsById.set(run.toolUseId, run);
      }
    }
  }
  return runsById;
}

function findResultFile(result: WireScriptResult, path: string): ResultFile | undefined {
  for (const file of result.files) {
    const isPathMatch = file.path === path;
    if (isPathMatch) {
      return file;
    }
  }
  return undefined;
}

// An absent rating stays an absent key; a copied run never keeps the rating of another file.
function copyRunForFile(run: WireScriptRun, file: ResultFile): WireScriptRun {
  const copy: WireScriptRun = { ...run, axisPx: 0 };
  delete copy.confidence;
  if (file.confidence !== undefined) {
    copy.confidence = file.confidence;
  }
  return copy;
}

function compareRunInstants(left: WireScriptRun, right: WireScriptRun): number {
  return Date.parse(left.instant) - Date.parse(right.instant);
}

// A run stays where the name search put it unless a replayed result now decides its files.
// function listGuessRunsOfPair(pair: ViewPair): WireScriptRun[] {
function listGuessRunsOfPair(pair: RunRow): WireScriptRun[] {
  const guessRuns: WireScriptRun[] = [];
  for (const run of pair.scriptRuns ?? []) {
    const result = getRunResult(run.toolUseId);
    if (result === undefined) {
      guessRuns.push(run);
      continue;
    }
    if (result.outcome !== WireRunOutcome.replayed) {
      guessRuns.push(run);
    }
  }
  return guessRuns;
}

function findReplayedResult(run: WireScriptRun): WireScriptResult | undefined {
  const result = getRunResult(run.toolUseId);
  if (result === undefined) {
    return undefined;
  }
  if (result.outcome !== WireRunOutcome.replayed) {
    return undefined;
  }
  return result;
}

// function listReplayedRunsOfPair(runsById: Map<string, WireScriptRun>, pair: ViewPair): WireScriptRun[] {
function listReplayedRunsOfPair(runsById: Map<string, WireScriptRun>, pair: RunRow): WireScriptRun[] {
  const replayedRuns: WireScriptRun[] = [];
  for (const run of runsById.values()) {
    const result = findReplayedResult(run);
    if (result === undefined) {
      continue;
    }
    const file = findResultFile(result, pair.path);
    if (file !== undefined) {
      replayedRuns.push(copyRunForFile(run, file));
    }
  }
  return replayedRuns;
}

function applyRunsToPair(runsById: Map<string, WireScriptRun>, pair: ViewPair): ViewPair {
  const scriptRuns = [...listGuessRunsOfPair(pair), ...listReplayedRunsOfPair(runsById, pair)];
  if (pair.scriptRuns === undefined) {
    if (scriptRuns.length === 0) {
      return pair;
    }
  }
  return { ...pair, scriptRuns: scriptRuns.sort(compareRunInstants) };
}

function applyRunsToOrphan(runsById: Map<string, WireScriptRun>, orphan: ViewOrphan, entries: RunOnNoViewPair[]): ViewOrphan {
  const namedRuns: WireScriptRun[] = [];
  for (const entry of entries) {
    const isNamedPath = entry.path === orphan.path;
    if (isNamedPath) {
      namedRuns.push(entry.run);
    }
  }
  const row: RunRow = { path: orphan.path, scriptRuns: namedRuns };
  const scriptRuns = [...listGuessRunsOfPair(row), ...listReplayedRunsOfPair(runsById, row)];
  if (orphan.scriptRuns === undefined) {
    if (scriptRuns.length === 0) {
      return orphan;
    }
  }
  return { ...orphan, scriptRuns: scriptRuns.sort(compareRunInstants) };
}

// Before a replay a run's dots are name-search guesses; a replayed run sits on exactly its changed files.
export function applyReplayResultsToView(view: WireLayer1View): WireLayer1View {
  const runsById = collectFirstRunById(view);
  const pairs: WireLayer1View["pairs"] = [];
  for (const pair of view.pairs) {
    pairs.push(applyRunsToPair(runsById, pair));
  }
  const diskOrphans: WireLayer1View["diskOrphans"] = [];
  const isLoaded = isScriptRunsLoaded(view);
  if (isLoaded) {
    const orphanRunsById = collectFirstRunById(view);
    for (const entry of listReplayedRunsOnNoViewPair(view)) {
      const isSeen = orphanRunsById.has(entry.run.toolUseId);
      if (!isSeen) {
        orphanRunsById.set(entry.run.toolUseId, entry.run);
      }
    }
    const entries = listRunsOnNoViewPair(view);
    for (const orphan of view.diskOrphans) {
      diskOrphans.push(applyRunsToOrphan(orphanRunsById, orphan, entries));
    }
  }
  if (!isLoaded) {
    diskOrphans.push(...view.diskOrphans);
  }
  // return { ...view, pairs };
  return { ...view, pairs, diskOrphans };
}
