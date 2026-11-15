// Gaps: runs of dropped states that a recorded script may have hidden, and the sidecar file that lists them.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { listInverseCommits, type InverseCommit, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { FileEventType } from "./engineV3_replay_reverse_events.ts";

export enum ReplayGapKind {
    Dropped = "dropped",
    Born = "born",
}

// droppedStates are in ascending position order (newest first). A made-up state is included.
export type ReplayGap = {
    kind: ReplayGapKind;
    newerPosition: number;
    olderPosition: number | undefined;
    droppedStates: OrderedKnownState[];
};

export type ScriptReplayTaskRecord = {
    taskId: string;
    instant: string;
    jsonlPath: string;
    line: number;
    toolUseId: string | null;
    executorKind: ScriptExecutorKind;
    language: string | null;
    cwd: string;
    code: string;
    invokedScriptPath: string | null;
    runInBackground: boolean;
};

export type ReplayGapRecord = {
    newerPosition: number;
    olderPosition: number | null;
    droppedPositions: number[];
    scriptTasks: ScriptReplayTaskRecord[];
};

export type BornlessRecord = { nextFreePosition: number; oldestInstant: string; oldestJsonlPath: string };

export type ReplayGapsSidecar = { gaps: ReplayGapRecord[]; bornless: BornlessRecord | null };

export const REPLAY_GAPS_FILE_NAME = "jfred-gaps.json";

export type UnfilledScriptGap = { firstScriptInstant: Date; newerCommit: InverseCommit; olderCommit: InverseCommit | undefined };

type UnknownRun = { firstPosition: number; lastPosition: number };

function listUnknownRuns(states: FileKnownState[]): UnknownRun[] {
    const unknownRuns: UnknownRun[] = [];
    let openRun: UnknownRun | undefined;
    for (const [position, state] of states.entries()) {
        if (state.confidence === StateConfidence.Unknown) {
            if (openRun === undefined) {
                openRun = { firstPosition: position, lastPosition: position };
                unknownRuns.push(openRun);
            } else {
                openRun.lastPosition = position;
            }
        } else {
            openRun = undefined;
        }
    }
    return unknownRuns;
}

function isStateScriptMayWrite(state: FileKnownState): boolean {
    return state.event.type === FileEventType.ScriptMayWrite;
}

// A script that is the oldest event may have created the file, so a made-up "before" state asks for a guess of absence.
function createMadeUpBeforeState(states: FileKnownState[], oldestDroppedState: FileKnownState, madeUpPosition: number): OrderedKnownState | undefined {
    if (!isStateScriptMayWrite(oldestDroppedState)) {
        return undefined;
    }
    const hasBeforeState = states.some((state) => state.event === oldestDroppedState.event && state.moment === StateMoment.BeforeEvent);
    if (hasBeforeState) {
        return undefined;
    }
    const madeUpState: FileKnownState = { event: oldestDroppedState.event, moment: StateMoment.BeforeEvent, confidence: StateConfidence.Unknown, isFileAbsent: false, text: undefined };
    return { state: madeUpState, position: madeUpPosition };
}

export function listReplayGapsFromStates(states: FileKnownState[]): ReplayGap[] {
    const gaps: ReplayGap[] = [];
    for (const unknownRun of listUnknownRuns(states)) {
        if (unknownRun.firstPosition === 0) {
            throw new Error("listReplayGapsFromStates: position 0 is dropped, but it must be the disk-now state");
        }
        const droppedStates: OrderedKnownState[] = [];
        for (let position = unknownRun.firstPosition; position <= unknownRun.lastPosition; position++) {
            droppedStates.push({ state: states[position]!, position });
        }
        let olderPosition: number | undefined;
        if (unknownRun.lastPosition + 1 < states.length) {
            olderPosition = unknownRun.lastPosition + 1;
        } else {
            const madeUpState = createMadeUpBeforeState(states, states[unknownRun.lastPosition]!, unknownRun.lastPosition + 1);
            if (madeUpState !== undefined) {
                droppedStates.push(madeUpState);
            }
        }
        const hasScriptState = droppedStates.some((orderedState) => isStateScriptMayWrite(orderedState.state));
        if (hasScriptState) {
            gaps.push({ kind: ReplayGapKind.Dropped, newerPosition: unknownRun.firstPosition - 1, olderPosition, droppedStates });
        }
    }
    return gaps;
}

export function convertScriptRunToTaskRecord(run: ScriptRun): ScriptReplayTaskRecord {
    if (run.source === undefined) {
        throw new Error("convertScriptRunToTaskRecord: the script run has no source");
    }
    if (run.cwd === undefined) {
        throw new Error(`convertScriptRunToTaskRecord: the script run at ${run.source.filePath}:${run.source.lineNumber} has no cwd`);
    }
    if (run.timestamp === undefined) {
        throw new Error(`convertScriptRunToTaskRecord: the script run at ${run.source.filePath}:${run.source.lineNumber} has no timestamp`);
    }
    const toolUseId = run.toolUseId?.toString() ?? null;
    return {
        taskId: `${run.source.filePath}:${run.source.lineNumber}:${toolUseId ?? "none"}`,
        instant: run.timestamp.toISOString(),
        jsonlPath: run.source.filePath,
        line: run.source.lineNumber,
        toolUseId,
        // A run without an executor kind executes like python.
        executorKind: run.executorKind ?? ScriptExecutorKind.python,
        language: run.language ?? null,
        cwd: run.cwd.toString(),
        code: run.code,
        invokedScriptPath: run.invokedScriptPath ?? null,
        runInBackground: run.runInBackground ?? false,
    };
}

export function convertTaskRecordToScriptRun(record: ScriptReplayTaskRecord): ScriptRun {
    const run: ScriptRun = {
        code: record.code,
        timestamp: new Date(record.instant),
        cwd: new Path(record.cwd),
        source: { filePath: record.jsonlPath, lineNumber: record.line },
        executorKind: record.executorKind,
        runInBackground: record.runInBackground,
    };
    if (record.toolUseId !== null) {
        run.toolUseId = new Uuid(record.toolUseId);
    }
    if (record.language !== null) {
        run.language = record.language;
    }
    if (record.invokedScriptPath !== null) {
        run.invokedScriptPath = record.invokedScriptPath;
    }
    return run;
}

function convertGapToRecord(gap: ReplayGap): ReplayGapRecord {
    const scriptTasksByTaskId = new Map<string, ScriptReplayTaskRecord>();
    for (const orderedState of gap.droppedStates) {
        if (isStateScriptMayWrite(orderedState.state)) {
            const scriptRun = orderedState.state.event.scriptRun;
            if (scriptRun === undefined) {
                throw new Error(`convertGapToRecord: the script event at position ${orderedState.position} has no script run`);
            }
            const taskRecord = convertScriptRunToTaskRecord(scriptRun);
            scriptTasksByTaskId.set(taskRecord.taskId, taskRecord);
        }
    }
    return {
        newerPosition: gap.newerPosition,
        olderPosition: gap.olderPosition ?? null,
        droppedPositions: gap.droppedStates.map((orderedState) => orderedState.position),
        scriptTasks: [...scriptTasksByTaskId.values()],
    };
}

function buildBornlessRecord(states: FileKnownState[]): BornlessRecord | null {
    const hasSourceState = states.some((state) => state.event.source !== undefined);
    if (!hasSourceState) {
        return null;
    }
    const hasAbsentState = states.some((state) => state.isFileAbsent);
    if (hasAbsentState) {
        return null;
    }
    const hasHistoryEndGap = listUnknownRuns(states).some((unknownRun) => unknownRun.lastPosition === states.length - 1);
    if (hasHistoryEndGap) {
        return null;
    }
    for (let position = states.length - 1; position >= 0; position--) {
        const event = states[position]!.event;
        if (event.instant !== undefined) {
            if (event.source !== undefined) {
                return { nextFreePosition: states.length, oldestInstant: event.instant.toISOString(), oldestJsonlPath: event.source.filePath };
            }
        }
    }
    throw new Error("buildBornlessRecord: no state has both an instant and a source");
}

export function buildReplayGapsSidecar(states: FileKnownState[]): ReplayGapsSidecar {
    const gaps = listReplayGapsFromStates(states);
    return { gaps: gaps.map(convertGapToRecord), bornless: buildBornlessRecord(states) };
}

function getSidecarPath(repoFolder: Path): string {
    return join(repoFolder.toString(), REPLAY_GAPS_FILE_NAME);
}

export function writeReplayGapsSidecar(repoFolder: Path, sidecar: ReplayGapsSidecar): void {
    writeFileSync(getSidecarPath(repoFolder), JSON.stringify(sidecar, null, 2));
}

export function readReplayGapsSidecar(repoFolder: Path): ReplayGapsSidecar {
    return JSON.parse(readFileSync(getSidecarPath(repoFolder), "utf8")) as ReplayGapsSidecar;
}

export function isReplayGapsSidecarPresent(repoFolder: Path): boolean {
    return existsSync(getSidecarPath(repoFolder));
}

export function listUnfilledGapRecords(sidecar: ReplayGapsSidecar, storedPositions: Set<number>): ReplayGapRecord[] {
    return sidecar.gaps.filter((gapRecord) => {
        if (gapRecord.scriptTasks.length === 0) {
            return false;
        }
        return gapRecord.droppedPositions.some((droppedPosition) => !storedPositions.has(droppedPosition));
    });
}

// True when the newer commit was made by the same event as the first dropped state.
export function isGapHalfDropped(gap: ReplayGap, newerCommit: InverseCommit): boolean {
    const droppedEvent = gap.droppedStates[0]!.state.event;
    if (droppedEvent.type !== newerCommit.eventType) {
        return false;
    }
    if (droppedEvent.source?.filePath !== newerCommit.jsonlPath?.toString()) {
        return false;
    }
    if (droppedEvent.source?.lineNumber !== newerCommit.line) {
        return false;
    }
    return droppedEvent.instant?.getTime() === newerCommit.instant?.getTime();
}

export function isBornlessRecordFilled(bornless: BornlessRecord, storedPositions: Set<number>): boolean {
    if (!storedPositions.has(bornless.nextFreePosition)) {
        return false;
    }
    return storedPositions.has(bornless.nextFreePosition + 1);
}

function findCommitAtPosition(inverseCommits: InverseCommit[], position: number, fileName: string): InverseCommit {
    const inverseCommit = inverseCommits.find((candidate) => candidate.position === position);
    if (inverseCommit === undefined) {
        throw new Error(`findCommitAtPosition: ${fileName} has no commit at position ${position}`);
    }
    return inverseCommit;
}

function getCommitInstantTime(inverseCommit: InverseCommit, fileName: string): number {
    if (inverseCommit.instant === undefined) {
        throw new Error(`getCommitInstantTime: the commit at position ${inverseCommit.position} of ${fileName} has no instant`);
    }
    return inverseCommit.instant.getTime();
}

export function listUnfilledScriptGapsAtInstant(repoFolder: Path, fileName: string, instant: Date): UnfilledScriptGap[] {
    const sidecar = readReplayGapsSidecar(repoFolder);
    const inverseCommits = listInverseCommits(repoFolder, fileName);
    const storedPositions = new Set(inverseCommits.map((inverseCommit) => inverseCommit.position));
    const unfilledScriptGaps: UnfilledScriptGap[] = [];
    for (const gapRecord of listUnfilledGapRecords(sidecar, storedPositions)) {
        const firstScriptTime = Math.min(...gapRecord.scriptTasks.map((taskRecord) => new Date(taskRecord.instant).getTime()));
        const newerCommit = findCommitAtPosition(inverseCommits, gapRecord.newerPosition, fileName);
        let olderCommit: InverseCommit | undefined;
        if (gapRecord.olderPosition !== null) {
            olderCommit = findCommitAtPosition(inverseCommits, gapRecord.olderPosition, fileName);
            getCommitInstantTime(olderCommit, fileName);
        }
        // The disk-now commit has no instant on purpose: a gap under it has no newer bound.
        let newerBoundTime = Infinity;
        if (newerCommit.eventType !== FileEventType.DiskNow) {
            newerBoundTime = getCommitInstantTime(newerCommit, fileName);
        }
        if (firstScriptTime <= instant.getTime()) {
            if (newerBoundTime > instant.getTime()) {
                unfilledScriptGaps.push({ firstScriptInstant: new Date(firstScriptTime), newerCommit, olderCommit });
            }
        }
    }
    return unfilledScriptGaps;
}
