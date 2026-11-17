// The --step-all loop: steps every project file to its end with no key presses, runs r on each script stop, then walks back with b.

import { basename, sep } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { InverseStepOutcome, StepAllRecordKind, StepAllVerdict } from "../src/structures/vocabulary.ts";
import type { FileKnownState } from "./engineV3_file_known_states.ts";
import { createFileStep, type FileStep } from "./engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "./engineV3_file_step_write.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { assertStoreHasNoFullBuildRepos } from "./engineV3_step_store_guard.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, getRelativePathInProject, listStatesOfProjectFile, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { listProjectFilesOnDiskAndInLogs } from "./engineV3_inverse_repos_project_files.ts";
import { createTerminalBarsSink } from "./engineV3_inverse_repos_terminal_bars.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import type { StepCliSession } from "./engineV3_step_cli.ts";
import { checkBackwardWalk } from "./engineV3_step_all_backward.ts";
import { createCrashRecord, createSummary, getSecondsSince, parseReplayOutput, writeRecordLine, type StepAllCrash, type StepAllFileRecord, type StepAllStop, type StepAllSummary } from "./engineV3_step_all_records.ts";
import { formatSourceText, runReplayCommand } from "./engineV3_step_replay_command.ts";
import type { StepReplayContext } from "./engineV3_step_replay_context.ts";

export type StepAllInput = { projectFolder: Path; jsonlsFolder: Path; fileHistoryFolder: Path; storeFolder: Path; projectFiles: ProjectFile[]; transcriptsToParse: Path[]; resultsFile: Path };

type StepAllRun = {
    input: StepAllInput;
    getEvents: (fileIndex: number) => FileEvent[];
    statesByFile: (FileKnownState[] | undefined)[];
    scannedReplayFiles: ProjectFile[] | undefined;
};

const PROGRESS_ROW_NAME = "files";

function createReplayContext(run: StepAllRun, projectFile: ProjectFile): StepReplayContext {
    if (run.scannedReplayFiles === undefined) {
        run.scannedReplayFiles = listProjectFilesOnDiskAndInLogs(run.input.projectFolder, [run.input.jsonlsFolder]);
    }
    const replayFiles = [...run.scannedReplayFiles];
    if (!replayFiles.some((replayFile) => replayFile.file.equals(projectFile.file))) {
        replayFiles.push(projectFile);
    }
    const { projectFolder, jsonlsFolder, transcriptsToParse, fileHistoryFolder, storeFolder } = run.input;
    return { projectFolder, jsonlsFolder, transcriptsToParse, fileHistoryFolder, storeFolder, stepProjectFile: projectFile, replayFiles, walkedOtherFiles: undefined };
}

async function walkOneFile(run: StepAllRun, fileIndex: number): Promise<StepAllFileRecord> {
    const startMilliseconds = Date.now();
    const { projectFolder, storeFolder, projectFiles } = run.input;
    const projectFile = projectFiles[fileIndex]!;
    const relativeFile = getRelativePathInProject(projectFolder, projectFile.file).split(sep).join("/");
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
    const fileName = basename(projectFile.file.toString());
    let events: FileEvent[] = [];
    let step: FileStep | undefined;
    const stops: StepAllStop[] = [];
    let stepsForward = 0;
    let stepsBackward = 0;
    let backwardFailures: string[] = [];
    let crash: StepAllCrash | null = null;
    try {
        listStatesOfProjectFile(fileIndex, projectFiles, run.getEvents, run.statesByFile, new Set<number>());
        events = run.getEvents(fileIndex);
        step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
        const positionHistory = listInverseCommits(repoFolder, fileName, false).map((storedCommit) => storedCommit.position);
        let outcome: InverseStepOutcome | undefined;
        while (outcome !== InverseStepOutcome.NoOlderChange) {
            const result = stepFileAndWriteCommit(repoFolder, fileName, step, undefined).result;
            stepsForward += 1;
            outcome = result.outcome;
            if (result.writtenState !== undefined) {
                positionHistory.push(result.writtenState.position);
            }
            if (outcome === InverseStepOutcome.UnknownOrRoadblock) {
                const stop: StepAllStop = { eventType: result.eventType!, source: formatSourceText(result.source), engine: result.engine ?? null, outcome, replay: null };
                stops.push(stop);
                if (result.eventType === FileEventType.ScriptMayWrite) {
                    const session: StepCliSession = { repoFolder, fileName, relativeFile, events, step, replay: createReplayContext(run, projectFile) };
                    const replayed = await runReplayCommand(session, result, stepsForward);
                    stop.replay = parseReplayOutput(replayed);
                    positionHistory.push(...replayed.positions);
                }
            }
        }
        const backwardWalk = checkBackwardWalk(positionHistory, repoFolder, fileName);
        stepsBackward = backwardWalk.stepsBackward;
        backwardFailures = backwardWalk.failures;
    } catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }
        crash = createCrashRecord(error, step, events);
    }
    let verdict = StepAllVerdict.End;
    if (backwardFailures.length > 0) {
        verdict = StepAllVerdict.BackwardFailure;
    }
    if (crash !== null) {
        verdict = StepAllVerdict.Crash;
    }
    return { kind: StepAllRecordKind.File, file: relativeFile, verdict, stepsForward, stepsBackward, stops, crash, backwardFailures, seconds: getSecondsSince(startMilliseconds) };
}

export async function walkAllFilesInStepMode(input: StepAllInput): Promise<StepAllSummary> {
    const startMilliseconds = Date.now();
    const { projectFolder, fileHistoryFolder, storeFolder, projectFiles, transcriptsToParse, resultsFile } = input;
    assertStoreHasNoFullBuildRepos(storeFolder, projectFolder, projectFiles);
    buildOnDemandInverseReposForFiles(projectFolder, projectFiles, transcriptsToParse, storeFolder, new Date(), () => {});
    const run: StepAllRun = { input, getEvents: createProjectEventsLoader(projectFiles, transcriptsToParse, [fileHistoryFolder]), statesByFile: projectFiles.map(() => undefined), scannedReplayFiles: undefined };
    const reportProgress = createTerminalBarsSink(process.stderr, [PROGRESS_ROW_NAME]);
    const fileRecords: StepAllFileRecord[] = [];
    for (const fileIndex of projectFiles.keys()) {
        const fileRecord = await walkOneFile(run, fileIndex);
        writeRecordLine(resultsFile, fileRecord);
        fileRecords.push(fileRecord);
        const doneCount = fileRecords.length;
        reportProgress({ kind: DocumentResponseKind.progress, label: `${PROGRESS_ROW_NAME} ${doneCount}/${projectFiles.length} ${fileRecord.file}`, current: doneCount, total: projectFiles.length, file: PROGRESS_ROW_NAME, fileStepsDone: doneCount, fileStepsTotal: projectFiles.length });
    }
    const summary = createSummary(fileRecords, getSecondsSince(startMilliseconds));
    writeRecordLine(resultsFile, summary);
    return summary;
}
