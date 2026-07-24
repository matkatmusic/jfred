// Task 220 — the horizon key for the lineage-seed memo. The script stage queries every closure
// file's content at every executed run's instant; keying the seed cache by the raw instant
// (`path|beforeMs`) never repeats, so every query paid a full bounded replay (task-182 attempt 3,
// ~3 runs/min). A bounded replay's result is a deterministic function of the file's relevant
// inputs strictly before the cutoff: its own static lineage events (reconstruction_lineage_inputs.ts),
// and script runs that could touch it (this module — it probes the executionsByRun memo but
// NEVER executes a run, which would execute runs out of walk order). replayLineageContentBefore
// keys the seeds map by `${target}|h${horizonMs}` — queries between relevant inputs share a key
// and serve the cached seed.

import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { getDerivedCaches, type DerivedCaches } from "./reconstruction_corpus.ts";
import { checkTimestampPrecedesSkippedBaseline } from "./reconstruction_base_commit.ts";
import {
    ScriptExecutorKind,
    findScriptExecutionRuns,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { computeRunExecutionKey, type RunExecution } from "./reconstruction_script_runs.ts";
import { scriptCodeMayWriteFiles } from "./reconstruction_script_prestate.ts";
import { isJunkStateKey } from "./reconstruction_script_sandbox.ts";
import {
    findLatestInstantBefore,
    getAllStaticEventInstantsMs,
    getStaticInputsForTarget,
    type LineageStaticInputs,
} from "./reconstruction_lineage_inputs.ts";

const runKeysByRun = new WeakMap<ScriptRun, string>();

function getRunExecutionKeyOnce(run: ScriptRun): string {
    let key = runKeysByRun.get(run);
    if (key === undefined) {
        key = computeRunExecutionKey(run);
        runKeysByRun.set(run, key);
    }
    return key;
}

// The state keys one memoized execution changed, created, or deleted.
function computeChangedStateKeys(execution: RunExecution): string[] {
    if (execution.post === undefined) {
        return [];
    }
    const unionKeys = new Set([...execution.pre.keys(), ...execution.post.keys()]);
    const changedKeys: string[] = [];
    for (const key of unionKeys) {
        if (isJunkStateKey(key)) {
            continue;
        }
        if (execution.pre.get(key) === execution.post.get(key)) {
            continue;
        }
        changedKeys.push(key);
    }
    return changedKeys;
}

const changedKeysByExecution = new WeakMap<RunExecution, string[]>();

// Computed once per execution object — the full-content comparison is what makes a per-query
// diff too expensive.
function getChangedStateKeysOnce(execution: RunExecution): string[] {
    let changedKeys = changedKeysByExecution.get(execution);
    if (changedKeys === undefined) {
        changedKeys = computeChangedStateKeys(execution);
        changedKeysByExecution.set(execution, changedKeys);
    }
    return changedKeys;
}

// The refForTarget rule: a sandbox state key denotes a lineage path when it IS the path or the
// path ends with "/<key>".
function checkKeyMatchesLineagePath(stateKey: string, lineagePathStrings: string[]): boolean {
    return lineagePathStrings.some((pathString) => pathString === stateKey || pathString.endsWith(`/${stateKey}`));
}

// A run the beaconless ROLLING branch could re-execute against the target's rolling content —
// it bypasses the pre-baseline gate and the execution memo, so only bash and read-only code
// are provably inert there.
function checkRunCanRollForward(run: ScriptRun): boolean {
    if ((run.executorKind ?? ScriptExecutorKind.python) === ScriptExecutorKind.bash) {
        return false;
    }
    if (!scriptCodeMayWriteFiles(run.code)) {
        return false;
    }
    return true;
}

// A run the sandbox could ever execute on its own: roll-capable AND not behind a declined
// baseline (executeRunOnce's own gates, mirrored statically).
function checkRunIsDirectlyExecutable(run: ScriptRun): boolean {
    if (!checkRunCanRollForward(run)) {
        return false;
    }
    if (checkTimestampPrecedesSkippedBaseline(run.timestamp)) {
        return false;
    }
    return true;
}

type RunScanState = {
    executionsSeen: number;
    relevantInstantsMs: number[];
    firstDiffRelevantMs: number | undefined;
};

const runScansByDerived = new WeakMap<DerivedCaches, Map<string, RunScanState>>();

// Whether one pre-first-touch run is relevant: directly executable but not yet memoized
// (unknown effects), or memoized with a diff that touches the target's lineage.
function checkRunIsRelevantByMemo(run: ScriptRun, derived: DerivedCaches, inputs: LineageStaticInputs): boolean {
    if (!checkRunIsDirectlyExecutable(run)) {
        return false;
    }
    const execution = derived.executionsByRun.get(getRunExecutionKeyOnce(run));
    if (execution === undefined) {
        return true;
    }
    if (execution.post === undefined) {
        return false;
    }
    return getChangedStateKeysOnce(execution).some((key) => checkKeyMatchesLineagePath(key, inputs.lineagePathStrings));
}

// One target's relevant run instants, scanned in ascending run order.
// ponytail: after the first proven script touch every later roll-capable run is relevant —
// per-run rolling-outcome prediction if script-touched files ever need sparse horizons.
function computeRunScan(
    records: TranscriptRecord[],
    derived: DerivedCaches,
    inputs: LineageStaticInputs,
): RunScanState {
    const sortedRuns = [...findScriptExecutionRuns(records)].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    const relevantInstantsMs: number[] = [];
    let firstDiffRelevantMs: number | undefined;
    for (const run of sortedRuns) {
        const runMs = run.timestamp.getTime();
        const rollingModePossible = firstDiffRelevantMs !== undefined && runMs > firstDiffRelevantMs;
        const relevant = rollingModePossible
            ? checkRunCanRollForward(run)
            : checkRunIsRelevantByMemo(run, derived, inputs);
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

// The scan is reused while executionsByRun has not grown (entries are only ever added), and
// recomputed when a new execution lands — that is the "advances with the run cutoff" increment.
function getRunScanForTarget(
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
    if (cached !== undefined && cached.executionsSeen === derived.executionsByRun.size) {
        return cached;
    }
    const scan = computeRunScan(records, derived, inputs);
    scansByTarget.set(target.toString(), scan);
    return scan;
}

// The lineage-seed memo key for (target, before): the target plus the latest relevant input
// strictly before the query instant. Two instants with equal horizons have identical
// relevant-input sets, hence byte-identical bounded-replay results.
export function computeLineageSeedHorizonKey(
    records: TranscriptRecord[],
    reader: BackupReader,
    target: Path,
    before: Date,
): string {
    const inputs = getStaticInputsForTarget(records, target);
    const derived = getDerivedCaches(records, reader);
    const scan = getRunScanForTarget(records, derived, target, inputs);
    const beforeMs = before.getTime();
    let horizonMs = Math.max(
        findLatestInstantBefore(inputs.ownInstantsMs, beforeMs),
        findLatestInstantBefore(scan.relevantInstantsMs, beforeMs),
    );
    if (scan.firstDiffRelevantMs !== undefined) {
        // ponytail: post-first-touch, any later static event floods the horizon — a proven
        // script move could splice another path's history into this chain; track proven pairs
        // instead if the flood ever costs real serves.
        const floodMs = findLatestInstantBefore(getAllStaticEventInstantsMs(records), beforeMs);
        if (floodMs > scan.firstDiffRelevantMs) {
            horizonMs = Math.max(horizonMs, floodMs);
        }
    }
    return `${target.toString()}|h${horizonMs}`;
}
