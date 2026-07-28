// Script-execution replay: memoized sandbox runs, run selection, lineage replay window, and script-born file discovery; consumed by reconstruction_script_stage.ts.

import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { checkTimestampPrecedesSkippedBaseline } from "./reconstruction_base_commit.ts";
import { getDerivedCaches } from "./reconstruction_corpus.ts";
import { Path, type Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { type BackupReader } from "./reconstruction_sidecar.ts";
import {
    ScriptExecutorKind,
    findScriptExecutionRuns,
    formatRunSource,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import {
    getPreExecutionState,
    scriptCodeMayWriteFiles,
    type LineageContentBefore,
} from "./reconstruction_script_prestate.ts";
import { isJunkStateKey, runScriptAgainstState } from "./reconstruction_script_sandbox.ts";
import { matchRenamePairs } from "./reconstruction_script_renames.ts";
import {
    ReconstructionCounter,
    incrementReconstructionCounter,
} from "./reconstruction_counters.ts";

// Memoized per run per records array since each sandbox run costs ~100ms; invalidated alongside its derived-cache siblings.
export type RunExecution = { pre: Map<string, string>; post: Map<string, string> | undefined };

// Runs at/after the innermost replay cutoff would re-enter their own in-flight execution, so they're excluded from pre-state builds.
let activeLineageReplayCutoff: Date | undefined;

// Narrows the window only — never widens it.
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

// All runs pass when no lineage replay is in progress.
export function selectRunsWithinReplayWindow(runs: ScriptRun[]): ScriptRun[] {
    if (activeLineageReplayCutoff === undefined) {
        return runs;
    }
    const cutoffMs = activeLineageReplayCutoff.getTime();
    return runs.filter((run) => run.timestamp.getTime() < cutoffMs);
}

// These three skip labels are exported for the gate and spawn-count tests.
export const PROGRESS_LABEL_READ_ONLY_SKIP_PREFIX = "skipping read-only script run";

export const PROGRESS_LABEL_PRE_BASELINE_SKIP_PREFIX = "skipping pre-baseline script run";

export const PROGRESS_LABEL_NON_PYTHON_SKIP_PREFIX = "skipping non-python sandbox run";

// An absent executor kind runs like python; exported so horizon's memo probes (task 220) build the same key.
export function computeRunExecutionKey(run: ScriptRun): string {
    const executorKind = run.executorKind ?? ScriptExecutorKind.python;
    return `${run.timestamp.getTime()}|${executorKind}|${run.code}`;
}

export function executeRunOnce(
    run: ScriptRun,
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): RunExecution {
    incrementReconstructionCounter(ReconstructionCounter.executionRequests);
    const byRun = getDerivedCaches(records, reader).executionsByRun;
    const key = computeRunExecutionKey(run);
    const cached = byRun.get(key);
    if (cached !== undefined) {
        incrementReconstructionCounter(ReconstructionCounter.executionCacheHits);
        return cached;
    }
    if (checkTimestampPrecedesSkippedBaseline(run.timestamp)) {
        reportReconstructionProgress(`${PROGRESS_LABEL_PRE_BASELINE_SKIP_PREFIX} @ ${run.timestamp.toISOString()}${formatRunSource(run)}`);
        const skipped: RunExecution = { pre: new Map(), post: undefined };
        byRun.set(key, skipped);
        return skipped;
    }
    // Task 192: bash always crashes to post:undefined in the python3-only sandbox; its rename/redirect evidence comes from separate static channels.
    if ((run.executorKind ?? ScriptExecutorKind.python) === ScriptExecutorKind.bash) {
        reportReconstructionProgress(`${PROGRESS_LABEL_NON_PYTHON_SKIP_PREFIX} @ ${run.timestamp.toISOString()}${formatRunSource(run)}`);
        const skipped: RunExecution = { pre: new Map(), post: undefined };
        byRun.set(key, skipped);
        return skipped;
    }
    // Item 68: no write primitive means no file evidence; callers check `post === undefined` before touching `pre`.
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
    const post = pre.size === 0 ? undefined : runScriptAgainstState(run.code, pre, formatRunSource(run), run.cwd);
    const execution: RunExecution = { pre, post };
    byRun.set(key, execution);
    return execution;
}

// Finds script-born files (an out.txt, a shutil.move destination) that left no Write/Edit/Bash event behind.
export function discoverScriptCreatedPaths(
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): Path[] {
    // Consent gate: discovery executes every recorded run, so a declined build skips it entirely, same as injectScriptExecutions.
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

// A move the sandbox diff proves, resolved to absolute paths (task 143; matcher in reconstruction_script_renames.ts).
export type ScriptRenamePair = { from: Path; to: Path };

// A script run's file changes, captured once (task 67) and reused (task 143) for the timeline's script-run rows.
export type ScriptRunFileChanges = {
    toolUseId: Uuid | undefined;
    timestamp: Date;
    code: string;
    changedPaths: Path[];
    renamedPaths: ScriptRenamePair[];
};

export function summarizeScriptRunFileChanges(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
): ScriptRunFileChanges[] {
    return findScriptExecutionRuns(records).map((run) => ({
        toolUseId: run.toolUseId,
        timestamp: run.timestamp,
        code: run.code,
        ...computeRunFileOutcome(run, records, reader),
    }));
}

// Paths executeRunOnce's diff shows changed; empty when execution is declined or no sidecar reader exists (task 143).
function computeRunFileOutcome(
    run: ScriptRun,
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
): { changedPaths: Path[]; renamedPaths: ScriptRenamePair[] } {
    if (reader === undefined || !isImpureExecutionAllowed()) return { changedPaths: [], renamedPaths: [] };
    const execution = executeRunOnce(run, records, reader);
    if (execution.post === undefined) return { changedPaths: [], renamedPaths: [] };
    const pairs = matchRenamePairs(execution.pre, execution.post);
    const pairSourceKeys = new Set(pairs.map((pair) => pair.fromKey));
    const changed = new Map<string, Path>();
    for (const key of new Set([...execution.pre.keys(), ...execution.post.keys()])) {
        if (isJunkStateKey(key)) continue;
        if (pairSourceKeys.has(key)) continue;
        if (execution.pre.get(key) === execution.post.get(key)) continue;
        const absolute = resolveAgainstCwd(run.cwd, new Path(key));
        if (!changed.has(absolute)) changed.set(absolute, new Path(absolute));
    }
    const renamedPaths = pairs.map((pair) => ({
        from: new Path(resolveAgainstCwd(run.cwd, new Path(pair.fromKey))),
        to: new Path(resolveAgainstCwd(run.cwd, new Path(pair.toKey))),
    }));
    return { changedPaths: [...changed.values()], renamedPaths };
}
