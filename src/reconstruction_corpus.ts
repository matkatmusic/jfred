// Per-records cache with two validity groups: stable branch selections and reader-gated derived caches.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupPoint } from "./reconstruction_backup_timeline.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { GitAddEvent, GitCommitEvent } from "./reconstruction_git_commit_events.ts";
import type { FileEvent, FileRevision } from "./reconstruction_engine.ts";
import type { RunExecution } from "./reconstruction_script_runs.ts";
import type { LineageSeedEntry } from "./reconstruction_lineage_memo.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { isPreBaselineReconstructionAllowed } from "./reconstruction_base_commit.ts";

// The reader/exec-gate-validated cache group: per-file histories (reconstructFileOver), lineage-seed texts (getLineageContentBefore), and sandbox executions (executeRunOnce).
export type DerivedCaches = {
    reader: BackupReader | undefined;
    impureAllowed: boolean;
    preBaselineAllowed: boolean;
    historiesByTarget: Map<string, FileRevision[]>;
    lineageSeedsByKey: Map<string, LineageSeedEntry>;
    executionsByRun: Map<string, RunExecution>;
};

export type CorpusState = {
    branchSelectionsByTip: Map<string, TranscriptRecord[]>;
    // undefined = not cached (preserves the no-surviving-head early-out semantics)
    liveBranch: TranscriptRecord[] | undefined;
    // pure function of the records alone — never invalidates (undefined = not cached)
    scriptRuns: ScriptRun[] | undefined;
    // pure function of the records alone — never invalidates; callers filter/map, never mutate
    fileEvents: FileEvent[] | undefined;
    // pure: the snapshots live in the records; keyed by cwd string
    backupTimelinesByCwd: Map<string, Map<string, BackupPoint[]>>;
    gitCommitEvents: GitCommitEvent[] | undefined; // pure function of the records alone
    gitAddEvents: GitAddEvent[] | undefined; // pure function of the records alone
    derived: DerivedCaches;
};

const corpusStates = new WeakMap<TranscriptRecord[], CorpusState>();

// An empty derived-cache group stamped with the reader and the CURRENT exec-gate and pre-baseline flag values.
function buildDerivedCaches(reader: BackupReader | undefined): DerivedCaches {
    return {
        reader,
        impureAllowed: isImpureExecutionAllowed(),
        preBaselineAllowed: isPreBaselineReconstructionAllowed(),
        historiesByTarget: new Map<string, FileRevision[]>(),
        lineageSeedsByKey: new Map<string, LineageSeedEntry>(),
        executionsByRun: new Map<string, RunExecution>(),
    };
}

// The corpus state for one records-array identity, created empty on first request.
export function getCorpusState(records: TranscriptRecord[]): CorpusState {
    let state = corpusStates.get(records);
    if (state === undefined) {
        state = {
            branchSelectionsByTip: new Map<string, TranscriptRecord[]>(),
            liveBranch: undefined,
            scriptRuns: undefined,
            fileEvents: undefined,
            backupTimelinesByCwd: new Map<string, Map<string, BackupPoint[]>>(),
            gitCommitEvents: undefined,
            gitAddEvents: undefined,
            derived: buildDerivedCaches(undefined),
        };
        corpusStates.set(records, state);
    }
    return state;
}

// Rebuilds derived caches when reader, exec-gate, or pre-baseline flag changed.
export function getDerivedCaches(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
): DerivedCaches {
    const state = getCorpusState(records);
    if (state.derived.reader !== reader) {
        state.derived = buildDerivedCaches(reader);
        return state.derived;
    }
    if (state.derived.impureAllowed !== isImpureExecutionAllowed()) {
        state.derived = buildDerivedCaches(reader);
        return state.derived;
    }
    if (state.derived.preBaselineAllowed !== isPreBaselineReconstructionAllowed()) {
        state.derived = buildDerivedCaches(reader);
    }
    return state.derived;
}

