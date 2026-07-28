// Script-execution replay: memoized sandbox runs, run selection for a target, the lineage replay
// window, and discovery of script-born files. The reconstruction stage that consumes these lives
// in reconstruction_script_stage.ts.

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

// Memoized per distinct run per records array; each sandbox run costs ~100ms and call sites
// multiply. The memo is invalidated with its derived-cache siblings.
export type RunExecution = { pre: Map<string, string>; post: Map<string, string> | undefined };

// Runs at/after the innermost replay's cutoff can only produce events the cut discards, and
// processing them let a pre-state build re-enter its own in-flight execution.
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

// An absent executor kind means a synthetic test run, which executes like python. Exported so
// the horizon module's memo probes (task 220) can build the identical key without executing.
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
    // Task 192: bash always crashed to post:undefined under the python3-only sandbox, and its
    // rename/redirect evidence is extracted statically through separate channels anyway.
    if ((run.executorKind ?? ScriptExecutorKind.python) === ScriptExecutorKind.bash) {
        reportReconstructionProgress(`${PROGRESS_LABEL_NON_PYTHON_SKIP_PREFIX} @ ${run.timestamp.toISOString()}${formatRunSource(run)}`);
        const skipped: RunExecution = { pre: new Map(), post: undefined };
        byRun.set(key, skipped);
        return skipped;
    }
    // Item 68: no write primitive means no file evidence; the empty pre is safe because every
    // caller checks `post === undefined` before touching `pre`.
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

// Finds script-born files (an out.txt, a shutil.move destination) that left no Write/Edit/Bash
// event behind.
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

// A move the sandbox diff proves, resolved to absolute paths for the wire document (task 143;
// the state-key matcher lives in reconstruction_script_renames.ts).
export type ScriptRenamePair = { from: Path; to: Path };

// One recorded script run and the files its sandbox execution changed, created, or deleted —
// captured at reconstruction time (task 67; executeRunOnce is memoized, so a consented build
// pays nothing extra) and carried onto the wire document for the timeline's script-run rows.
// renamedPaths (task 143) holds the proven move pairs; their SOURCE paths are collapsed out
// of changedPaths so "modified N file(s)" counts files, not both sides of every move.
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

// The absolute paths executeRunOnce's pre/post diff shows changed, created, or deleted (the
// union of both states' keys covers all three in one content comparison), with rename-pair
// sources collapsed out (task 143) — empty on a declined build (nothing may execute) or when
// no sidecar reader exists. The gate check comes BEFORE executeRunOnce so a declined build
// never runs a script.
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
