// The per-transcript-set cache state for one reconstruction: every memo that is keyed on a
// records-array identity lives here, in two validity groups. Branch selections are pure
// functions of the records alone and never invalidate. Derived caches depend on the sidecar
// reader identity AND the exec-gate flag; a change to either discards the whole group (a
// declined build's results must never serve a consented one, and vice versa). Guards
// (seedingLineages, activeLineageReplayCutoff, resolving) are execution-stack state, not
// cache state — they stay in their own modules. Design: plans/items14-23-26-33-close.md
// (Phase 4, item 14).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { BackupPoint } from "./reconstruction_backup_timeline.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { GitCommitEvent } from "./reconstruction_git_commit_events.ts";
import type { FileEvent, FileRevision } from "./reconstruction_engine.ts";
import type { RunExecution } from "./reconstruction_script_runs.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";

// The reader/exec-gate-validated cache group: per-file histories (reconstructFileOver),
// lineage-seed texts (getLineageContentBefore), and sandbox executions (executeRunOnce).
export type DerivedCaches = {
    reader: BackupReader | undefined;
    impureAllowed: boolean;
    historiesByTarget: Map<string, FileRevision[]>;
    lineageSeedsByKey: Map<string, string | undefined>;
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
    derived: DerivedCaches;
};

const corpusStates = new WeakMap<TranscriptRecord[], CorpusState>();

// An empty derived-cache group stamped with the reader and the CURRENT exec-gate value.
function buildDerivedCaches(reader: BackupReader | undefined): DerivedCaches {
    return {
        reader,
        impureAllowed: isImpureExecutionAllowed(),
        historiesByTarget: new Map<string, FileRevision[]>(),
        lineageSeedsByKey: new Map<string, string | undefined>(),
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
            derived: buildDerivedCaches(undefined),
        };
        corpusStates.set(records, state);
    }
    return state;
}

// The derived-cache group, rebuilt empty whenever the reader identity or the exec-gate flag
// differ from the values the group was stamped with (the one validity rule, applied uniformly —
// including to executions).
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
    }
    return state.derived;
}

