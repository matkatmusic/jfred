// Placement stage: splice committed-blob diffs as synthetic user edits (s85).

import { randomUUID } from "node:crypto";
import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { executeRunOnce } from "./reconstruction_script_runs.ts";
import {
    findScriptExecutionRuns,
    type ScriptExecutionEvent,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import { computeScriptStateKey } from "./reconstruction_script_prestate.ts";
import { runScriptAgainstState } from "./reconstruction_script_sandbox.ts";
import type { FileEvent, OverwriteEvent, UserEditEvent, WriteEvent } from "./reconstruction_engine.ts";
import { findGitAddEvents, findGitCommitEvents, type GitCommitEvent } from "./reconstruction_git_commit_events.ts";
import { findFallbackRepoDirs, readCommittedFileContent, readStagedFileContent } from "./reconstruction_git_evidence.ts";
import { applyAdditions, pureAdditionsFrom, type LineAddition } from "./reconstruction_git_additions.ts";

// A lineage event carrying the file's FULL content at its instant (not a hunk-based edit).
type FullContentEvent = WriteEvent | OverwriteEvent | UserEditEvent | ScriptExecutionEvent;

function isFullContentEvent(event: FileEvent): event is FullContentEvent {
    return event.kind === EventKind.write
        || event.kind === EventKind.overwrite
        || event.kind === EventKind.userEdit
        || event.kind === EventKind.scriptExecution;
}

// Find the run whose timestamp matches this event's instant.
function runAtInstant(runs: ScriptRun[], event: FileEvent): ScriptRun | undefined {
    return runs.find((run) => run.timestamp.getTime() === event.timestamp.getTime());
}

// Replay content through successive script runs, returning final and per-event results.
function replayRunsOver(
    content: string,
    eventIndices: number[],
    events: FileEvent[],
    runs: ScriptRun[],
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
): { final: string; rewrites: Map<number, string> } | undefined {
    let rolling = content;
    const rewrites = new Map<number, string>();
    for (const index of eventIndices) {
        const event = events[index]!;
        if (event.kind !== EventKind.scriptExecution) return undefined;
        const run = runAtInstant(runs, event);
        if (run === undefined) return undefined;
        const key = computeScriptStateKey(target, run.cwd);
        const preState = new Map(executeRunOnce(run, records, reader).pre);
        preState.set(key, rolling);
        const postState = runScriptAgainstState(run.code, preState, "", run.cwd);
        const post = postState?.get(key);
        if (post === undefined) return undefined;
        rewrites.set(index, post);
        rolling = post;
    }
    return { final: rolling, rewrites };
}

// Timestamp halfway between event[index] and its successor.
function midpointAfter(events: FileEvent[], index: number, fallbackEnd: Date): Date {
    const start = events[index]!.timestamp.getTime();
    const end = index + 1 < events.length ? events[index + 1]!.timestamp.getTime() : fallbackEnd.getTime();
    return new Date(Math.floor((start + end) / 2));
}

// Splice additions after baseIndex; accept only if forward replay reproduces the blob exactly.
function placementAfter(
    baseIndex: number,
    additions: LineAddition[],
    laterIndices: number[],
    blob: string,
    events: FileEvent[],
    runs: ScriptRun[],
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
    commitTimestamp: Date,
): FileEvent[] | undefined {
    const base = events[baseIndex] as FullContentEvent;
    const editedLines = applyAdditions(splitLines(base.content), additions);
    if (editedLines === undefined) return undefined;
    const edited = editedLines.join("\n") + "\n";
    const replayed = replayRunsOver(edited, laterIndices, events, runs, target, records, reader);
    if (replayed === undefined || replayed.final !== blob) return undefined;
    const userEdit: UserEditEvent = {
        kind: EventKind.userEdit,
        changeId: new Uuid(randomUUID()),
        target,
        content: edited,
        timestamp: midpointAfter(events, baseIndex, commitTimestamp),
    };
    noteStage({
        stage: "placeGitCommitEvidence",
        target,
        changeId: userEdit.changeId,
        detail: "spliced a committed-blob diff as a user edit at the earliest evidence-consistent point",
        when: userEdit.timestamp,
    });
    const result = events.map((event, index) => {
        const rewrite = replayed.rewrites.get(index);
        return rewrite === undefined ? event : { ...event, content: rewrite };
    });
    result.splice(baseIndex + 1, 0, userEdit);
    return result;
}

// Place one blob's unexplained pure-addition diff onto the lineage, if possible.
function placeOneBlobDiff(
    blob: string,
    evidenceInstant: Date,
    events: FileEvent[],
    runs: ScriptRun[],
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
): FileEvent[] | undefined {
    const indexedEvents = events.map((event, index) => ({ event, index }));
    const atOrBeforeEvidence = indexedEvents.filter(({ event }) => event.timestamp.getTime() <= evidenceInstant.getTime());
    const fullContentEvents = atOrBeforeEvidence.filter(({ event }) => isFullContentEvent(event));
    const beforeEvidence = fullContentEvents.map(({ index }) => index);
    if (beforeEvidence.length === 0) return undefined;
    const atEvidence = events[beforeEvidence[beforeEvidence.length - 1]!] as FullContentEvent;
    if (atEvidence.content === blob) return undefined;
    const additions = pureAdditionsFrom(splitLines(atEvidence.content), splitLines(blob));
    if (additions === undefined) return undefined;
    for (let position = 0; position < beforeEvidence.length; position += 1) {
        const placed = placementAfter(
            beforeEvidence[position]!,
            additions,
            beforeEvidence.slice(position + 1),
            blob,
            events,
            runs,
            target,
            records,
            reader,
            evidenceInstant,
        );
        if (placed !== undefined) return placed;
    }
    return undefined;
}

// One commit's blob for `target`, resolved from the recorded repo (with decay fallbacks).
function placeOneCommitDiff(
    commit: GitCommitEvent,
    events: FileEvent[],
    runs: ScriptRun[],
    target: Path,
    records: TranscriptRecord[],
    reader: BackupReader,
): FileEvent[] | undefined {
    if (commit.cwd === undefined) return undefined;
    // item 46: const blob = readCommittedFileContent(commit.cwd, commit.timestamp, target, findPreservedRepoDir(records));
    const blob = readCommittedFileContent(commit.cwd, commit.timestamp, target, findFallbackRepoDirs(records));
    if (blob === undefined) return undefined;
    return placeOneBlobDiff(blob, commit.timestamp, events, runs, target, records, reader);
}

// Place the staged blob from the last recorded `git add` for this target.
function placeStagedBlobDiff(
    records: TranscriptRecord[],
    events: FileEvent[],
    runs: ScriptRun[],
    target: Path,
    reader: BackupReader,
): FileEvent[] | undefined {
    const addsOfTarget = findGitAddEvents(records).filter((add) => add.path.equals(target));
    if (addsOfTarget.length === 0) return undefined;
    const lastAdd = addsOfTarget.reduce((a, b) => (b.timestamp.getTime() >= a.timestamp.getTime() ? b : a));
    if (lastAdd.cwd === undefined) return undefined;
    const blob = readStagedFileContent(lastAdd.cwd, target, findFallbackRepoDirs(records));
    if (blob === undefined) return undefined;
    return placeOneBlobDiff(blob, lastAdd.timestamp, events, runs, target, records, reader);
}

// Splice unexplained pure-addition diffs from git commits/adds as synthetic edits (s85, s87).
export function placeGitCommitEvidence(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
    target: Path,
): FileEvent[] {
    if (!isImpureExecutionAllowed()) return events;
    const runs = findScriptExecutionRuns(records);
    for (const commit of findGitCommitEvents(records)) {
        const placed = placeOneCommitDiff(commit, events, runs, target, records, reader);
        if (placed !== undefined) return placed;
    }
    const placedFromStage = placeStagedBlobDiff(records, events, runs, target, reader);
    if (placedFromStage !== undefined) return placedFromStage;
    return events;
}
