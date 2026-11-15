// Tasks: the script runs a span needs, with the files that wait on each, and the made-up "born" gap.

import { basename, isAbsolute, relative, sep } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { findScriptExecutionRuns, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { isScriptCodeWriteCapable } from "../src/reconstruction_script_prestate.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { StateConfidence, StateMoment } from "./engineV3_file_known_states.ts";
import { listInverseCommits, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import {
    ReplayGapKind, convertScriptRunToTaskRecord, convertTaskRecordToScriptRun, isBornlessRecordFilled, isReplayGapsSidecarPresent,
    listUnfilledGapRecords, readReplayGapsSidecar,
    type BornlessRecord, type ReplayGap, type ScriptReplayTaskRecord,
} from "./engineV3_script_replay_gaps.ts";

export enum ScriptReplayTaskReason {
    NamedByFile = "named-by-file",
    BirthCandidate = "birth-candidate",
}

export type WaitingFile = { relativePath: string; reason: ScriptReplayTaskReason };

export type ScriptReplayTask = { record: ScriptReplayTaskRecord; instant: Date; waitingFiles: WaitingFile[] };

export const MAX_BIRTH_CANDIDATES_PER_FILE = 5;

function isCwdInsideFolder(cwd: Path, folder: Path): boolean {
    const relativePath = relative(folder.toString(), cwd.toString());
    if (isAbsolute(relativePath)) {
        return false;
    }
    return relativePath.split(sep)[0] !== "..";
}

// A birth candidate is a write-capable foreground run in the project before the oldest known event of a file.
function isBirthCandidateRun(run: ScriptRun, oldestInstant: Date, recordedProjectFolder: Path): boolean {
    if (run.timestamp.getTime() >= oldestInstant.getTime()) {
        return false;
    }
    if (run.cwd === undefined) {
        return false;
    }
    if (!isCwdInsideFolder(run.cwd, recordedProjectFolder)) {
        return false;
    }
    if (!isScriptCodeWriteCapable(run.code)) {
        return false;
    }
    if (run.runInBackground === true) {
        return false;
    }
    return run.source !== undefined;
}

export function listBirthCandidateRecords(transcriptFiles: Path[], oldestInstant: Date, recordedProjectFolder: Path): ScriptReplayTaskRecord[] {
    const candidateRuns: ScriptRun[] = [];
    for (const transcriptFile of transcriptFiles) {
        const records = loadTranscript(transcriptFile.toString()).records;
        for (const run of findScriptExecutionRuns(records)) {
            if (isBirthCandidateRun(run, oldestInstant, recordedProjectFolder)) {
                candidateRuns.push(run);
            }
        }
    }
    candidateRuns.sort((firstRun, secondRun) => firstRun.timestamp.getTime() - secondRun.timestamp.getTime());
    return candidateRuns.slice(-MAX_BIRTH_CANDIDATES_PER_FILE).map(convertScriptRunToTaskRecord);
}

export function buildBornGap(bornless: BornlessRecord, record: ScriptReplayTaskRecord): ReplayGap {
    const event: FileEvent = {
        type: FileEventType.ScriptMayWrite,
        instant: new Date(record.instant),
        source: { filePath: record.jsonlPath, lineNumber: record.line },
        commitHash: undefined,
        bytes: undefined,
        row: undefined,
        moveOrCopySourceFile: undefined,
        removedByScript: false,
        movedAwayToFile: undefined,
        scriptRun: convertTaskRecordToScriptRun(record),
    };
    const atEventState: OrderedKnownState = {
        state: { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Unknown, isFileAbsent: false, text: undefined },
        position: bornless.nextFreePosition,
    };
    const beforeEventState: OrderedKnownState = {
        state: { event, moment: StateMoment.BeforeEvent, confidence: StateConfidence.Unknown, isFileAbsent: false, text: undefined },
        position: bornless.nextFreePosition + 1,
    };
    return { kind: ReplayGapKind.Born, newerPosition: bornless.nextFreePosition - 1, olderPosition: undefined, droppedStates: [atEventState, beforeEventState] };
}

function addWaitingFileToTask(tasksByTaskId: Map<string, ScriptReplayTask>, record: ScriptReplayTaskRecord, waitingFile: WaitingFile, toInstant: Date): void {
    const instant = new Date(record.instant);
    if (instant.getTime() > toInstant.getTime()) {
        return;
    }
    let task = tasksByTaskId.get(record.taskId);
    if (task === undefined) {
        task = { record, instant, waitingFiles: [] };
        tasksByTaskId.set(record.taskId, task);
    }
    const isFileAlreadyWaiting = task.waitingFiles.some((existingFile) => existingFile.relativePath === waitingFile.relativePath);
    if (!isFileAlreadyWaiting) {
        task.waitingFiles.push(waitingFile);
    }
}

export function listScriptReplayTasks(storeFolder: Path, projectFolder: Path, projectFiles: ProjectFile[], recordedProjectFolder: Path, toInstant: Date, jsonlsFolders: Path[]): ScriptReplayTask[] {
    const transcriptFiles = listTranscriptFiles(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString()));
    const tasksByTaskId = new Map<string, ScriptReplayTask>();
    const birthCandidatesByKey = new Map<string, ScriptReplayTaskRecord[]>();
    for (const projectFile of projectFiles) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
        if (!isReplayGapsSidecarPresent(repoFolder)) {
            throw new Error(`listScriptReplayTasks: ${repoFolder.toString()} has no gaps file: build the inverse repos first`);
        }
        const sidecar = readReplayGapsSidecar(repoFolder);
        const inverseCommits = listInverseCommits(repoFolder, basename(projectFile.file.toString()));
        const storedPositions = new Set(inverseCommits.map((inverseCommit) => inverseCommit.position));
        const relativePath = relative(projectFolder.toString(), projectFile.file.toString()).split(sep).join("/");
        for (const gapRecord of listUnfilledGapRecords(sidecar, storedPositions)) {
            for (const record of gapRecord.scriptTasks) {
                addWaitingFileToTask(tasksByTaskId, record, { relativePath, reason: ScriptReplayTaskReason.NamedByFile }, toInstant);
            }
        }
        const bornless = sidecar.bornless;
        if (bornless !== null) {
            if (!isBornlessRecordFilled(bornless, storedPositions)) {
                const candidateKey = bornless.oldestInstant;
                let candidateRecords = birthCandidatesByKey.get(candidateKey);
                if (candidateRecords === undefined) {
                    candidateRecords = listBirthCandidateRecords(transcriptFiles, new Date(bornless.oldestInstant), recordedProjectFolder);
                    birthCandidatesByKey.set(candidateKey, candidateRecords);
                }
                for (const record of candidateRecords) {
                    addWaitingFileToTask(tasksByTaskId, record, { relativePath, reason: ScriptReplayTaskReason.BirthCandidate }, toInstant);
                }
            }
        }
    }
    return [...tasksByTaskId.values()].sort((firstTask, secondTask) => firstTask.instant.getTime() - secondTask.instant.getTime());
}
