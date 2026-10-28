// Per-target scan of script runs that could change a lineage, cached per derived caches.

import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { DerivedCaches } from "./reconstruction_corpus.ts";
import { checkTimestampPrecedesSkippedBaseline } from "./reconstruction_base_commit.ts";
import {
  ScriptExecutorKind,
  findScriptExecutionRuns,
  type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { computeRunExecutionKey } from "./reconstruction_script_runs.ts";
import { isScriptCodeWriteCapable } from "./reconstruction_script_prestate.ts";
import { getChangedStateKeysOnce, isAnyKeyOnLineagePath } from "./reconstruction_lineage_changed_keys.ts";
import type { LineageStaticInputs } from "./reconstruction_lineage_inputs.ts";

const runKeysByRun = new WeakMap<ScriptRun, string>();

function getRunExecutionKeyOnce(run: ScriptRun): string {
  let key = runKeysByRun.get(run);
  if (key === undefined) {
    key = computeRunExecutionKey(run);
    runKeysByRun.set(run, key);
  }
  return key;
}

// Whether a beaconless rolling branch could re-execute this run.
function isRunRollCapable(run: ScriptRun): boolean {
  return (run.executorKind ?? ScriptExecutorKind.python) !== ScriptExecutorKind.bash
    && isScriptCodeWriteCapable(run.code);
}

// Roll-capable and not behind a declined baseline.
function isRunDirectlyExecutable(run: ScriptRun): boolean {
  return isRunRollCapable(run) && !checkTimestampPrecedesSkippedBaseline(run.timestamp);
}

function compareRunsByTimestamp(a: ScriptRun, b: ScriptRun): number {
  return a.timestamp.getTime() - b.timestamp.getTime();
}

export type RunScanState = {
  executionsSeen: number;
  relevantInstantsMs: number[];
  firstDiffRelevantMs: number | undefined;
};

const runScansByDerived = new WeakMap<DerivedCaches, Map<string, RunScanState>>();

// Relevant if executable and unmemoized, or memoized with a diff touching this lineage.
function isRunRelevantByMemo(run: ScriptRun, derived: DerivedCaches, inputs: LineageStaticInputs): boolean {
  const isExecutable = isRunDirectlyExecutable(run);
  if (!isExecutable) {
    return false;
  }
  const execution = derived.executionsByRun.get(getRunExecutionKeyOnce(run));
  if (execution === undefined) {
    return true;
  }
  if (execution.post === undefined) {
    return false;
  }
  return isAnyKeyOnLineagePath(getChangedStateKeysOnce(execution), inputs.lineagePathStrings);
}

// One target's relevant run instants, scanned in ascending run order.
// ponytail: after first script touch, all roll-capable runs are relevant; per-run prediction if sparse horizons needed.
function computeRunScan(
  records: TranscriptRecord[],
  derived: DerivedCaches,
  inputs: LineageStaticInputs,
): RunScanState {
  const sortedRuns = [...findScriptExecutionRuns(records)].sort(compareRunsByTimestamp);
  const relevantInstantsMs: number[] = [];
  let firstDiffRelevantMs: number | undefined;
  for (const run of sortedRuns) {
    const runMs = run.timestamp.getTime();
    const rollingModePossible = firstDiffRelevantMs !== undefined && runMs > firstDiffRelevantMs;
    const relevant = rollingModePossible
      ? isRunRollCapable(run)
      : isRunRelevantByMemo(run, derived, inputs);
    if (!relevant) {
      continue;
    }
    relevantInstantsMs.push(runMs);
    if (firstDiffRelevantMs === undefined) {
      firstDiffRelevantMs = runMs;
    }
  }
  return { executionsSeen: derived.executionsByRun.size, relevantInstantsMs, firstDiffRelevantMs };
}

// Reuse cached scan while executionsByRun has not grown; recompute on new entries.
export function getRunScanForTarget(
  records: TranscriptRecord[],
  derived: DerivedCaches,
  target: Path,
  inputs: LineageStaticInputs,
): RunScanState {
  let scansByTarget = runScansByDerived.get(derived);
  if (scansByTarget === undefined) {
    scansByTarget = new Map<string, RunScanState>();
    runScansByDerived.set(derived, scansByTarget);
  }
  const cached = scansByTarget.get(target.toString());
  if (cached !== undefined) {
    const isCacheCurrent = cached.executionsSeen === derived.executionsByRun.size;
    if (isCacheCurrent) {
      return cached;
    }
  }
  const scan = computeRunScan(records, derived, inputs);
  scansByTarget.set(target.toString(), scan);
  return scan;
}
