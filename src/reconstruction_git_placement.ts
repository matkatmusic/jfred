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
import type { FileEvent, UserEditEvent, WriteEvent } from "./reconstruction_engine.ts";
import { findGitCommitEvents, type GitCommitEvent } from "./reconstruction_git_commit_events.ts";
import { findFallbackRepoDirs, readCommittedFileContent } from "./reconstruction_git_evidence.ts";

// A lineage event carrying the file's FULL content at its instant (not a hunk-based edit).
type FullContentEvent = WriteEvent | UserEditEvent | ScriptExecutionEvent;

function isFullContentEvent(event: FileEvent): event is FullContentEvent {
    return event.kind === EventKind.write
        || event.kind === EventKind.userEdit
        || event.kind === EventKind.scriptExecution;
}

// One line the blob carries beyond the base, anchored to the base line it follows (undefined =
// inserted at the start of the file).
type LineAddition = { anchor: string | undefined; line: string };

// The blob as the base plus pure line insertions, or undefined when the blob deletes or changes
// any base line (then the diff is not "unexplained additions" and the stage must stay silent).
function pureAdditionsFrom(baseLines: string[], blobLines: string[]): LineAddition[] | undefined {
    const additions: LineAddition[] = [];
    let baseIndex = 0;
    for (const line of blobLines) {
        if (baseIndex < baseLines.length && line === baseLines[baseIndex]) {
            baseIndex += 1;
            continue;
        }
        additions.push({ anchor: baseIndex > 0 ? baseLines[baseIndex - 1] : undefined, line });
    }
    if (baseIndex !== baseLines.length || additions.length === 0) return undefined;
    return additions;
}

// `lines` with each addition inserted after the LAST occurrence of its anchor (or at the start),
// or undefined when an anchor line is absent — the addition cannot be re-anchored onto this base.
function applyAdditions(lines: string[], additions: LineAddition[]): string[] | undefined {
    const result = [...lines];
    for (const { anchor, line } of additions) {
        if (anchor === undefined) {
            result.unshift(line);
            continue;
        }
        const at = result.lastIndexOf(anchor);
        if (at < 0) return undefined;
        result.splice(at + 1, 0, line);
    }
    return result;
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
        const postState = runScriptAgainstState(run.code, preState);
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

// Place one commit's unexplained diff onto the lineage, or undefined when the blob is absent,
// already explained, not a pure addition, or no placement survives forward re-execution.
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
    const indexedEvents = events.map((event, index) => ({ event, index }));
    const atOrBeforeCommit = indexedEvents.filter(({ event }) => event.timestamp.getTime() <= commit.timestamp.getTime());
    const fullContentEvents = atOrBeforeCommit.filter(({ event }) => isFullContentEvent(event));
    const beforeCommit = fullContentEvents.map(({ index }) => index);
    if (beforeCommit.length === 0) return undefined;
    const atCommit = events[beforeCommit[beforeCommit.length - 1]!] as FullContentEvent;
    if (atCommit.content === blob) return undefined;
    const additions = pureAdditionsFrom(splitLines(atCommit.content), splitLines(blob));
    if (additions === undefined) return undefined;
    for (let position = 0; position < beforeCommit.length; position += 1) {
        const placed = placementAfter(
            beforeCommit[position]!,
            additions,
            beforeCommit.slice(position + 1),
            blob,
            events,
            runs,
            target,
            records,
            reader,
            commit.timestamp,
        );
        if (placed !== undefined) return placed;
    }
    return undefined;
}

// Reconstruction stage: when a recorded `git commit`'s blob for `target` differs from the lineage
// content at the commit instant by pure line additions no event explains, splice those additions
// as a synthetic user edit at the earliest point from which forward re-execution of the remaining
// runs reproduces the blob byte-exactly (s85: the out-of-band comment lands between the move and
// the rename runs). Every absence — no commits, no repo, no blob, no valid placement — is a
// silent no-op.
export function placeGitCommitEvidence(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
    target: Path,
): FileEvent[] {
    if (!isImpureExecutionAllowed()) return events;
    const commits = findGitCommitEvents(records);
    if (commits.length === 0) return events;
    const runs = findScriptExecutionRuns(records);
    for (const commit of commits) {
        const placed = placeOneCommitDiff(commit, events, runs, target, records, reader);
        if (placed !== undefined) return placed;
    }
    return events;
}
