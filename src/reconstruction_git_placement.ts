// --- the placement stage ----------------------------------------------------------------------------
// Reconstruction stage: splice a committed blob's unexplained pure-addition diff onto the lineage
// as a synthetic user edit at the earliest evidence-consistent point (s85).

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

// The recorded run whose instant stamps `event`, or undefined (a script-execution event is always
// injected at its run's timestamp, so the instant is the join key).
function runAtInstant(runs: ScriptRun[], event: FileEvent): ScriptRun | undefined {
    return runs.find((run) => run.timestamp.getTime() === event.timestamp.getTime());
}

// Replay `content` through the runs behind `events`, seeding each run's sandbox with the rolling
// content; returns the final content and each event's recomputed content, or undefined when any
// event has no run or the run drops the file.
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

// The instant halfway between an event and its successor (or the commit) — "strictly after" the
// base event and "strictly before" the next.
function midpointAfter(events: FileEvent[], index: number, fallbackEnd: Date): Date {
    const start = events[index]!.timestamp.getTime();
    const end = index + 1 < events.length ? events[index + 1]!.timestamp.getTime() : fallbackEnd.getTime();
    return new Date(Math.floor((start + end) / 2));
}

// Try splicing the additions right after `events[baseIndex]`: re-anchor them onto that event's
// content, replay every later pre-commit run over the edited content, and accept only when the
// replayed end-state reproduces the committed blob byte-exactly.
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

// Place one evidence blob's unexplained diff onto the lineage, or undefined when the blob is
// absent, already explained, not a pure addition, or no placement survives forward re-execution.
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

// The staged (index) blob behind the LAST recorded `git add <target>`, when one exists. Only the
// last add is trusted: the index holds one blob per path — whatever the most recent add staged.
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

// Reconstruction stage: when a recorded `git commit`'s (or, failing that, a recorded
// `git add`'s STAGED) blob for `target` differs from the lineage content at the evidence instant
// by pure line additions no event explains, splice those additions as a synthetic user edit at
// the earliest point from which forward re-execution of the remaining runs reproduces the blob
// byte-exactly (s85: the out-of-band comment lands between the move and the rename runs; s87:
// the driver's duplicate comment exists ONLY in the staged blob — `git add` with no commit).
// Every absence — no commits/adds, no repo, no blob, no valid placement — is a silent no-op.
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
