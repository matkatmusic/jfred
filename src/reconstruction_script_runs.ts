// Script-execution replay: memoized sandbox runs, run selection for a target, the lineage replay
// window, and discovery of script-born files. The reconstruction stage that consumes these lives
// in reconstruction_script_stage.ts.

import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { getDerivedCaches } from "./reconstruction_corpus.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { type BackupReader } from "./reconstruction_sidecar.ts";
import {
    findScriptExecutionRuns,
    formatRunSource,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import {
    getPreExecutionState,
    scriptCodeMayWriteFiles,
    type LineageContentBefore,
} from "./reconstruction_script_prestate.ts";
import { runScriptAgainstState } from "./reconstruction_script_sandbox.ts";

// One execution per distinct run per records array: pre-state build + sandbox run, memoized —
// Phases 3–4 multiply call sites and each sandbox run costs ~100ms. The memo lives in the
// corpus's derived-cache group, so it is invalidated with its siblings when the reader identity
// or the exec-gate flag changes.
export type RunExecution = { pre: Map<string, string>; post: Map<string, string> | undefined };
// corpus: moved to reconstruction_corpus.ts (item 14)
// const executionsByRecords = new WeakMap<TranscriptRecord[], Map<string, RunExecution>>();

// The truncation instant of the innermost lineage replay in progress. A seeded replay's result
// is cut by lastRevisionStrictlyBefore(revisions, cutoff), so runs at/after the cutoff can only
// produce events the cut discards — processing them is provably wasted work (and is what let a
// run's pre-state build re-enter its own in-flight execution once per seeded file).
let activeLineageReplayCutoff: Date | undefined;

// Narrow the active replay window to `before` (never widen it) and return the previous cutoff
// for restoreLineageReplayWindow.
export function enterLineageReplayWindow(before: Date): Date | undefined {
    const previous = activeLineageReplayCutoff;
    if (previous !== undefined) {
        if (previous.getTime() <= before.getTime()) {
            return previous;
        }
    }
    activeLineageReplayCutoff = before;
    return previous;
}

export function restoreLineageReplayWindow(previous: Date | undefined): void {
    activeLineageReplayCutoff = previous;
}

// Only the runs whose effects can survive the active replay window's strictly-before cut —
// all runs when no lineage replay is in progress.
export function selectRunsWithinReplayWindow(runs: ScriptRun[]): ScriptRun[] {
    if (activeLineageReplayCutoff === undefined) {
        return runs;
    }
    const cutoffMs = activeLineageReplayCutoff.getTime();
    return runs.filter((run) => run.timestamp.getTime() < cutoffMs);
}

// Progress label announced instead of a sandbox execution when the static gate proves a run
// read-only (TASKS.md item 68). Exported for the spawn-count tests.
export const PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX = "skipping read-only script run";

export function executeRunOnce(
    run: ScriptRun,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): RunExecution {
    // corpus: moved to reconstruction_corpus.ts (item 14)
    // let byRun = executionsByRecords.get(records);
    // if (byRun === undefined) {
    //     byRun = new Map<string, RunExecution>();
    //     executionsByRecords.set(records, byRun);
    // }
    const byRun = getDerivedCaches(records, reader).executionsByRun;
    const key = `${run.timestamp.getTime()}|${run.code}`;
    const cached = byRun.get(key);
    if (cached !== undefined) return cached;
    // Item 68: a script with no statically detectable write primitive cannot change or
    // create files, so its pre-state build and sandbox run are provably no-ops for evidence.
    // The empty pre is safe: every caller checks `post === undefined` before touching `pre`.
    if (!scriptCodeMayWriteFiles(run.code)) {
        reportReconstructionProgress(
            `${PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX} @ ${run.timestamp.toISOString()}${formatRunSource(run)}`,
        );
        const skipped: RunExecution = { pre: new Map(), post: undefined };
        byRun.set(key, skipped);
        return skipped;
    }
    reportReconstructionProgress(`executing script run @ ${run.timestamp.toISOString()}${formatRunSource(run)}`);
    const pre = getPreExecutionState(run, records, reader, seedContent);
    const post = pre.size === 0 ? undefined : runScriptAgainstState(run.code, pre, formatRunSource(run));
    const execution: RunExecution = { pre, post };
    byRun.set(key, execution);
    return execution;
}

// The pre/post-state key that denotes `target`, or undefined when the run's sandbox never saw it.
export function refForTarget(target: Path, stateKeys: string[]): string | undefined {
    const targetStr = target.toString();
    return stateKeys.find((ref) => targetStr === ref || targetStr.endsWith(`/${ref}`));
}

// Whether executing the run shows `target` changed or created — the glob-agnostic gate for a
// script that finds its files (glob.glob) instead of naming them.
export function runTouchesTarget(
    run: ScriptRun,
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): boolean {
    const execution = executeRunOnce(run, records, reader, seedContent);
    if (execution.post === undefined) return false;
    const ref = refForTarget(target, [...execution.pre.keys(), ...execution.post.keys()]);
    if (ref === undefined) return false;
    const contentBefore = execution.pre.get(ref);
    const contentAfter = execution.post.get(ref);
    return contentAfter !== undefined && contentAfter !== contentBefore;
}

// The latest run at or before `when` whose source mentions `target`'s basename — or, when no run
// names it, the latest whose EXECUTION provably changes it. False positives are harmless — the
// forward test rejects them. Substring stays primary so existing scenarios keep their run selection.
export function runForTarget(
    runs: ScriptRun[],
    target: Path,
    when: Date,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): ScriptRun | undefined {
    const basename = target.toString().split("/").pop() ?? "";
    let chosen: ScriptRun | undefined;
    for (const run of runs) {
        if (run.timestamp.getTime() > when.getTime()) continue;
        if (run.code.includes(basename)) chosen = run;
    }
    if (chosen !== undefined) return chosen;
    for (const run of runs) {
        if (run.timestamp.getTime() > when.getTime()) continue;
        if (runTouchesTarget(run, target, records, reader, seedContent)) chosen = run;
    }
    return chosen;
}

// A sandbox artifact no scenario tracks: python bytecode caches.
function isJunkStateKey(key: string): boolean {
    return key.includes("__pycache__") || key.endsWith(".pyc");
}

// Absolute paths of files that exist only AFTER an executed run — script-born files (an out.txt,
// a shutil.move destination) that left no Write/Edit/Bash event.
export function discoverScriptCreatedPaths(
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): Path[] {
    // Consent gate: discovery EXECUTES every recorded run, so a declined build must skip it
    // entirely — same contract as injectScriptExecutions.
    if (!isImpureExecutionAllowed()) return [];
    const created = new Map<string, Path>();
    const runs = findScriptExecutionRuns(records);
    if (runs.length > 0) {
        reportReconstructionProgress(`discovering script-created files (${runs.length} runs)`);
    }
    for (const run of runs) {
        const execution = executeRunOnce(run, records, reader, seedContent);
        if (execution.post === undefined) continue;
        for (const key of execution.post.keys()) {
            if (execution.pre.has(key) || isJunkStateKey(key)) continue;
            const absolute = resolveAgainstCwd(run.cwd, new Path(key));
            if (!created.has(absolute)) created.set(absolute, new Path(absolute));
        }
    }
    return [...created.values()];
}

// One recorded script run and the files its sandbox execution changed, created, or deleted —
// captured at reconstruction time (task 67; executeRunOnce is memoized, so a consented build
// pays nothing extra) and carried onto the wire document for the timeline's script-run rows.
export type ScriptRunFileChanges = {
    toolUseId: Uuid | undefined;
    timestamp: Date;
    code: string;
    changedPaths: Path[];
};

export function summarizeScriptRunFileChanges(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
): ScriptRunFileChanges[] {
    return findScriptExecutionRuns(records).map((run) => ({
        toolUseId: run.toolUseId,
        timestamp: run.timestamp,
        code: run.code,
        changedPaths: computeRunChangedPaths(run, records, reader),
    }));
}

// The absolute paths executeRunOnce's pre/post diff shows changed, created, or deleted (the
// union of both states' keys covers all three in one content comparison) — [] on a declined
// build (nothing may execute) or when no sidecar reader exists. The gate check comes BEFORE
// executeRunOnce so a declined build never runs a script.
function computeRunChangedPaths(
    run: ScriptRun,
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
): Path[] {
    if (reader === undefined || !isImpureExecutionAllowed()) return [];
    const execution = executeRunOnce(run, records, reader);
    if (execution.post === undefined) return [];
    const changed = new Map<string, Path>();
    for (const key of new Set([...execution.pre.keys(), ...execution.post.keys()])) {
        if (isJunkStateKey(key)) continue;
        if (execution.pre.get(key) === execution.post.get(key)) continue;
        const absolute = resolveAgainstCwd(run.cwd, new Path(key));
        if (!changed.has(absolute)) changed.set(absolute, new Path(absolute));
    }
    return [...changed.values()];
}
