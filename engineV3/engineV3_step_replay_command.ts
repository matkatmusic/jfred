// The r command of step mode: replays the script of the current stop in a container and stores the texts it leaves.

import { Path } from "../src/structures/domain.ts";
// import { InverseStepEngine, InverseStepOutcome, StopGapKind } from "../src/structures/vocabulary.ts";
import { InverseStepEngine, InverseStepOutcome, OtherFilesPolicy, StopGapKind } from "../src/structures/vocabulary.ts";
import type { ProgressEvent, RecordSource } from "../src/parse/loadTranscript.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import type { StateConfidence } from "./engineV3_file_known_states.ts";
import type { FileStepResult } from "./engineV3_file_step.ts";
import { acceptReplayedTexts } from "./engineV3_file_step_replay.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { getRelativePathInProject, listProjectFilesWithStaleInverseRepos } from "./engineV3_inverse_repos_for_project.ts";
import { createTerminalBarsSink } from "./engineV3_inverse_repos_terminal_bars.ts";
import { FileEventType } from "./engineV3_replay_reverse_events.ts";
import { DockerReadiness, checkDockerReadiness } from "./engineV3_script_replay_container.ts";
import { replaySingleGapInContainer, type ScriptReplaySettings } from "./engineV3_script_replay_run.ts";
import { ReplayWorkspace } from "./engineV3_script_replay_workspace.ts";
import { writeReplayedGapIntoInverseRepo } from "./engineV3_script_replay_writer.ts";
import type { StepCliSession } from "./engineV3_step_cli.ts";
import { listReplayFilesOfProject, type ReplayCommandOutput } from "./engineV3_step_replay_context.ts";
import { findStopGap } from "./engineV3_step_replay_gap.ts";
import { walkOtherFilesToTheEnd } from "./engineV3_step_other_files.ts";
import { readOtherFilesWalkedToTheEnd } from "./engineV3_step_finished_other_files.ts";
import { assertStoreHasNoFullBuildRepos, assertStoreIsInsideCacheFolder } from "./engineV3_step_store_guard.ts";

export type ReplayedLineFields = { stepNumber: number; relativeFile: string; confidence: StateConfidence; positions: number[]; commit: string; instant: Date | undefined; source: string; tasks: { taskId: string; exitCode: number | null; timedOut: boolean }[] };

const NOT_A_SCRIPT_STOP_REASON = "r works only right after a stop on a script that may write; press f first";

export function formatReplayRefusalLine(stepNumber: number, relativeFile: string, source: string | null, reason: string): string {
    return JSON.stringify({ step: stepNumber, file: relativeFile, outcome: InverseStepOutcome.ReplayRefused, engine: InverseStepEngine.Replay, reason, source });
}

export function formatReplayedLine(fields: ReplayedLineFields): string {
    return JSON.stringify({
        step: fields.stepNumber,
        file: fields.relativeFile,
        outcome: InverseStepOutcome.Replayed,
        engine: InverseStepEngine.Replay,
        confidence: fields.confidence,
        positions: fields.positions,
        position: fields.positions[fields.positions.length - 1],
        commit: fields.commit,
        instant: fields.instant?.toISOString() ?? null,
        eventType: FileEventType.ScriptMayWrite,
        source: fields.source,
        tasks: fields.tasks,
        changedLabels: [],
    });
}

export function formatSourceText(source: RecordSource | undefined): string | null {
    if (source === undefined) {
        return null;
    }
    return `${source.filePath}:${source.lineNumber}`;
}

function findScriptStopSource(lastResult: FileStepResult | undefined): RecordSource | undefined {
    if (lastResult === undefined) {
        return undefined;
    }
    if (lastResult.outcome !== InverseStepOutcome.UnknownOrRoadblock) {
        return undefined;
    }
    if (lastResult.eventType !== FileEventType.ScriptMayWrite) {
        return undefined;
    }
    return lastResult.source;
}

function createRefusal(stepNumber: number, relativeFile: string, source: RecordSource | undefined, reason: string): ReplayCommandOutput {
    return { line: formatReplayRefusalLine(stepNumber, relativeFile, formatSourceText(source), reason), positions: [], isContainerFailure: false };
}

function reportReplayProgress(event: ProgressEvent): void {
    process.stderr.write(`${event.label}\n`);
}

export async function runReplayCommand(session: StepCliSession, lastResult: FileStepResult | undefined, stepNumber: number): Promise<ReplayCommandOutput> {
    const replay = session.replay;
    if (replay === undefined) {
        throw new Error("runReplayCommand: the program context is missing");
    }
    const stopSource = findScriptStopSource(lastResult);
    if (stopSource === undefined) {
        return createRefusal(stepNumber, session.relativeFile, lastResult?.source, NOT_A_SCRIPT_STOP_REASON);
    }
    assertStoreIsInsideCacheFolder(replay.storeFolder, new Path(INVERSE_REPOS_CACHE_FOLDER));
    const storedCommits = listInverseCommits(session.repoFolder, session.fileName, true);
    const stopGap = findStopGap(session.events, storedCommits, stopSource, replay.projectFolder, session.relativeFile);
    if (stopGap.kind === StopGapKind.Refused) {
        return createRefusal(stepNumber, session.relativeFile, stopSource, stopGap.reason);
    }
    const replayFiles = listReplayFilesOfProject(replay);
    assertStoreHasNoFullBuildRepos(replay.storeFolder, replay.projectFolder, replayFiles);
    // const staleFiles = listProjectFilesWithStaleInverseRepos(replay.storeFolder, replay.projectFolder, replayFiles, replay.transcriptsToParse);
    const staleFiles = listProjectFilesWithStaleInverseRepos(replay.storeFolder, replay.projectFolder, replayFiles, replay.transcriptsToParse, replay.earliestBoundary);
    if (staleFiles.length > 0) {
        const staleRelativePath = getRelativePathInProject(replay.projectFolder, staleFiles[0]!.file);
        return createRefusal(stepNumber, session.relativeFile, stopSource, `the repo of ${staleRelativePath} no longer matches the logs or the disk (the logs grew or a file changed): quit, and start again with a new --store folder`);
    }
    if (replay.otherFilesPolicy === OtherFilesPolicy.RefuseIfUnfinished) {
        if (replay.walkedOtherFiles === undefined) {
            const reportReadProgress = createTerminalBarsSink(process.stderr, ["other files"]);
            const finishedOtherFiles = readOtherFilesWalkedToTheEnd({ projectFolder: replay.projectFolder, replayFiles, replayedProjectFile: replay.stepProjectFile, storeFolder: replay.storeFolder, transcriptsToParse: replay.transcriptsToParse, fileHistoryFolders: replay.fileHistoryFolders, reportProgress: reportReadProgress, earliestBoundary: replay.earliestBoundary });
            if (finishedOtherFiles.refusalReason !== undefined) {
                return createRefusal(stepNumber, session.relativeFile, stopSource, finishedOtherFiles.refusalReason);
            }
            replay.walkedOtherFiles = finishedOtherFiles.walkedFiles;
        }
    }
    const dockerReadiness = checkDockerReadiness();
    if (dockerReadiness !== DockerReadiness.Ready) {
        throw new Error(`runReplayCommand: docker is not ready: ${dockerReadiness}`);
    }
    // The walk of the other files writes into their repos, so only the WalkThem policy runs it.
    if (replay.otherFilesPolicy === OtherFilesPolicy.WalkThem) {
        if (replay.walkedOtherFiles === undefined) {
            const reportWalkProgress = createTerminalBarsSink(process.stderr, ["other files"]);
            // replay.walkedOtherFiles = walkOtherFilesToTheEnd({ projectFolder: replay.projectFolder, replayFiles, replayedProjectFile: replay.stepProjectFile, storeFolder: replay.storeFolder, transcriptsToParse: replay.transcriptsToParse, fileHistoryFolder: replay.fileHistoryFolder, reportProgress: reportWalkProgress });
            // replay.walkedOtherFiles = walkOtherFilesToTheEnd({ projectFolder: replay.projectFolder, replayFiles, replayedProjectFile: replay.stepProjectFile, storeFolder: replay.storeFolder, transcriptsToParse: replay.transcriptsToParse, fileHistoryFolders: replay.fileHistoryFolders, reportProgress: reportWalkProgress });
            replay.walkedOtherFiles = walkOtherFilesToTheEnd({ projectFolder: replay.projectFolder, replayFiles, replayedProjectFile: replay.stepProjectFile, storeFolder: replay.storeFolder, transcriptsToParse: replay.transcriptsToParse, fileHistoryFolders: replay.fileHistoryFolders, reportProgress: reportWalkProgress, earliestBoundary: replay.earliestBoundary });
        }
    }
    const workspace = new ReplayWorkspace(replay.storeFolder, replay.projectFolder, replay.projectFolder, replayFiles);
    for (const walkedFile of replay.walkedOtherFiles!) {
        workspace.setCommits(walkedFile.file, walkedFile.commits);
    }
    const fileIndex = replayFiles.findIndex((projectFile) => projectFile.file.equals(replay.stepProjectFile.file));
    // const settings: ScriptReplaySettings = { projectFolder: replay.projectFolder, recordedProjectFolder: replay.projectFolder, projectFiles: replayFiles, jsonlsFolders: [replay.jsonlsFolder], snapshotFolders: [replay.fileHistoryFolder], storeFolder: replay.storeFolder };
    const settings: ScriptReplaySettings = { projectFolder: replay.projectFolder, recordedProjectFolder: replay.projectFolder, projectFiles: replayFiles, jsonlsFolders: replay.jsonlsFolders, snapshotFolders: replay.fileHistoryFolders, storeFolder: replay.storeFolder };
    // const result = await replaySingleGapInContainer({ settings, workspace, tasks: stopGap.tasks, gap: stopGap.gap, startText: stopGap.startText, fileIndex }, reportReplayProgress, new AbortController().signal);
    const result = await replaySingleGapInContainer({ settings, workspace, tasks: stopGap.tasks, gap: stopGap.gap, startText: stopGap.startText, fileIndex }, reportReplayProgress, replay.abortSignal);
    if (result.textByPosition === undefined) {
        return { ...createRefusal(stepNumber, session.relativeFile, stopSource, result.failureReason!), isContainerFailure: true };
    }
    const report = writeReplayedGapIntoInverseRepo(session.repoFolder, session.fileName, stopGap.gap, result.textByPosition);
    acceptReplayedTexts(session.step, stopGap.gap, result.textByPosition);
    const tipPosition = report.insertedPositions[report.insertedPositions.length - 1]!;
    const tipCommit = listInverseCommits(session.repoFolder, session.fileName, false).find((storedCommit) => storedCommit.position === tipPosition)!;
    const stopEvent = session.events.find((event) => event.source?.filePath === stopSource.filePath && event.source?.lineNumber === stopSource.lineNumber);
    const tasks = result.outcomes.map((outcome) => ({ taskId: outcome.taskId, exitCode: outcome.exitCode, timedOut: outcome.timedOut }));
    const line = formatReplayedLine({ stepNumber, relativeFile: session.relativeFile, confidence: report.confidence, positions: report.insertedPositions, commit: tipCommit.commitHash.toString(), instant: stopEvent?.instant, source: formatSourceText(stopSource)!, tasks });
    return { line, positions: report.insertedPositions, isContainerFailure: false };
}
