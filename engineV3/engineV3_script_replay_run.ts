// Runs the recorded scripts a span needs, oldest first, in the locked-down container, and fills the gaps of the per-file repos.

import { rmSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Path } from "../src/structures/domain.ts";
import type { ProgressSink } from "../src/parse/loadTranscript.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { ScriptExecutorKind } from "../src/reconstruction_script_execution.ts";
import { SANDBOX_IMAGE } from "../src/reconstruction_script_sandbox_docker.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { StateMoment, type FileKnownState, type StateConfidence } from "./engineV3_file_known_states.ts";
import { listInverseCommits, type InverseCommit } from "./engineV3_inverse_repo.ts";
import {
    buildInverseReposForFiles, getInverseRepoFolderForFile, listKnownStatesForProjectFiles,
    type ProjectFile,
} from "./engineV3_inverse_repos_for_project.ts";
import { listProjectFilesOnDiskAndInLogs } from "./engineV3_inverse_repos_project_files.ts";
import { createTerminalBarsSink } from "./engineV3_inverse_repos_terminal_bars.ts";
import { isInternetCommand } from "./engineV3_replay_script_internet.ts";
import { applyEditToText, countOccurrences, type EditRow } from "./engineV3_replay_reverse.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import {
    DockerReadiness, SCRIPT_REPLAY_CONTAINER_PREFIX, SCRIPT_REPLAY_TIMEOUT_SECONDS, ScriptInterpreter,
    checkDockerReadiness, executeScriptReplayInContainer, removeScriptReplayContainers,
    type ScriptReplayChangeKind, type ScriptReplayRequest, type ScriptReplayResponse,
} from "./engineV3_script_replay_container.ts";
import {
    ReplayGapKind, convertScriptRunToTaskRecord, isGapHalfDropped, listReplayGapsFromStates, readReplayGapsSidecar,
    type ReplayGap, type ScriptReplayTaskRecord,
} from "./engineV3_script_replay_gaps.ts";
import { buildBornGap, ScriptReplayTaskReason, listScriptReplayTasks, type ScriptReplayTask } from "./engineV3_script_replay_tasks.ts";
import { ReplayWorkspace } from "./engineV3_script_replay_workspace.ts";
import { writeReplayedGapIntoInverseRepo } from "./engineV3_script_replay_writer.ts";

export enum ScriptTaskOutcomeKind { Replayed = "replayed", Refused = "refused", Failed = "failed" }
export type ScriptTaskFileOutcome = { relativePath: string; changeKind: ScriptReplayChangeKind | null; confidence: StateConfidence | null; isGapFilled: boolean };
export type ScriptTaskOutcome = {
    taskId: string;
    outcome: ScriptTaskOutcomeKind;
    reason: string | null;
    missingExecutable: string | null;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    files: ScriptTaskFileOutcome[];
};
export type ScriptReplaySettings = {
    projectFolder: Path;
    recordedProjectFolder: Path;
    projectFiles: ProjectFile[];
    jsonlsFolders: Path[];
    snapshotFolders: Path[];
    storeFolder: Path;
    containerNamePrefix?: string;
};

const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set(["python", "python3", "shell", "bash", "sh"]);
const NOT_NEEDED_REASON = "no unfilled gap needed this script";

type TaskRun = { outcome: ScriptTaskOutcome; response: ScriptReplayResponse | undefined };

type ActiveGap = {
    fileIndex: number;
    gapOrder: number;
    gap: ReplayGap;
    events: FileEvent[];
    runningText: string | undefined;
    textsByEvent: Map<FileEvent, { before: string | undefined; after: string | undefined }>;
    isFailed: boolean;
};

type ReplayStep = { activeGap: ActiveGap; event: FileEvent; instant: Date; isLastStep: boolean };

type ReplayContext = {
    settings: ScriptReplaySettings;
    workspace: ReplayWorkspace;
    signal: AbortSignal;
    reportProgress: ProgressSink;
    tasks: ScriptReplayTask[];
    tasksByTaskId: Map<string, ScriptReplayTask>;
    taskRunsByTaskId: Map<string, TaskRun>;
    relativePaths: string[];
    bornFileIndexes: Set<number>;
};

export function chooseScriptInterpreter(record: ScriptReplayTaskRecord): ScriptInterpreter {
    if (record.invokedScriptPath !== null) {
        if (record.invokedScriptPath.endsWith(".py")) {
            return ScriptInterpreter.Python;
        }
        if (record.invokedScriptPath.endsWith(".sh")) {
            return ScriptInterpreter.Bash;
        }
    }
    if (record.executorKind === ScriptExecutorKind.python) {
        return ScriptInterpreter.Python;
    }
    return ScriptInterpreter.Bash;
}

function isCwdInsideFolder(cwd: Path, folder: Path): boolean {
    const relativePath = relative(folder.toString(), cwd.toString());
    if (isAbsolute(relativePath)) {
        return false;
    }
    return relativePath.split(sep)[0] !== "..";
}

export function getScriptReplayRefusal(record: ScriptReplayTaskRecord, recordedProjectFolder: Path): string | undefined {
    if (record.runInBackground) {
        return "the script runs in the background";
    }
    if (isInternetCommand(record.code)) {
        return "the script uses the internet";
    }
    if (record.language !== null) {
        if (!ALLOWED_LANGUAGES.has(record.language)) {
            return `the script language ${record.language} is not python or shell`;
        }
    }
    if (!isCwdInsideFolder(new Path(record.cwd), recordedProjectFolder)) {
        return `the working folder ${record.cwd} is outside the project folder ${recordedProjectFolder.toString()}`;
    }
    if (record.invokedScriptPath !== null) {
        if (record.invokedScriptPath.endsWith(".js")) {
            return `the script ${record.invokedScriptPath} is JavaScript or TypeScript`;
        }
        if (record.invokedScriptPath.endsWith(".ts")) {
            return `the script ${record.invokedScriptPath} is JavaScript or TypeScript`;
        }
    }
    return undefined;
}

function formatMissingExecutableLine(name: string): string {
    return `script replay: missing executable or Python module ${name} in ${SANDBOX_IMAGE}: add it to sandbox-image/Dockerfile`;
}

function formatSlashPath(fromFolder: Path, toPath: Path): string {
    return relative(fromFolder.toString(), toPath.toString()).split(sep).join("/");
}

function getEventInstant(event: FileEvent): Date {
    if (event.instant === undefined) {
        throw new Error(`getEventInstant: the ${event.type} event has no instant`);
    }
    return event.instant;
}

function getScriptTaskId(event: FileEvent): string {
    if (event.scriptRun === undefined) {
        throw new Error(`getScriptTaskId: the script event at ${event.instant?.toISOString()} has no script run`);
    }
    return convertScriptRunToTaskRecord(event.scriptRun).taskId;
}

function getEditRowOfEvent(event: FileEvent): EditRow {
    if (event.row === undefined) {
        throw new Error(`getEditRowOfEvent: the edit event at ${event.instant?.toISOString()} has no row`);
    }
    if (event.row.toolName !== ToolName.Edit) {
        throw new Error(`getEditRowOfEvent: the row of the edit event at ${event.instant?.toISOString()} is not an Edit`);
    }
    return event.row;
}

function isEditApplicableForward(text: string | undefined, row: EditRow): text is string {
    if (text === undefined) {
        return false;
    }
    if (row.replaceAll) {
        return false;
    }
    return countOccurrences(text, row.oldString) === 1;
}

function createTaskOutcome(task: ScriptReplayTask): ScriptTaskOutcome {
    return {
        taskId: task.record.taskId,
        outcome: ScriptTaskOutcomeKind.Refused,
        reason: null,
        missingExecutable: null,
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        files: task.waitingFiles.map((waitingFile) => ({ relativePath: waitingFile.relativePath, changeKind: null, confidence: null, isGapFilled: false })),
    };
}

function applyResponseToOutcome(outcome: ScriptTaskOutcome, response: ScriptReplayResponse): void {
    outcome.exitCode = response.exitCode;
    outcome.timedOut = response.timedOut;
    outcome.stdout = response.stdout;
    outcome.stderr = response.stderr;
    outcome.missingExecutable = response.missingExecutable;
    outcome.outcome = ScriptTaskOutcomeKind.Replayed;
    if (response.missingExecutable !== null) {
        outcome.reason = formatMissingExecutableLine(response.missingExecutable);
        console.error(outcome.reason);
    }
    if (response.exitCode !== 0) {
        outcome.outcome = ScriptTaskOutcomeKind.Failed;
        if (outcome.reason === null) {
            outcome.reason = `the script exited with code ${response.exitCode}`;
        }
    }
    if (response.timedOut) {
        outcome.outcome = ScriptTaskOutcomeKind.Failed;
        if (outcome.reason === null) {
            outcome.reason = `the script ran longer than ${SCRIPT_REPLAY_TIMEOUT_SECONDS} seconds`;
        }
    }
    for (const fileOutcome of outcome.files) {
        const changedFile = response.changedFiles.find((candidate) => candidate.relativePath === fileOutcome.relativePath);
        if (changedFile !== undefined) {
            fileOutcome.changeKind = changedFile.changeKind;
        }
    }
}

async function executeTaskOnce(context: ReplayContext, task: ScriptReplayTask): Promise<TaskRun> {
    const cachedTaskRun = context.taskRunsByTaskId.get(task.record.taskId);
    if (cachedTaskRun !== undefined) {
        return cachedTaskRun;
    }
    const taskNumber = context.tasks.indexOf(task) + 1;
    context.reportProgress({ kind: DocumentResponseKind.progress, label: `replaying script ${taskNumber} of ${context.tasks.length}`, current: taskNumber, total: context.tasks.length });
    const outcome = createTaskOutcome(task);
    const taskRun: TaskRun = { outcome, response: undefined };
    context.taskRunsByTaskId.set(task.record.taskId, taskRun);
    const refusal = getScriptReplayRefusal(task.record, context.settings.recordedProjectFolder);
    if (refusal !== undefined) {
        outcome.reason = refusal;
        return taskRun;
    }
    const request: ScriptReplayRequest = {
        projectRoot: context.settings.recordedProjectFolder.toString(),
        cwd: task.record.cwd,
        interpreter: chooseScriptInterpreter(task.record),
        source: task.record.code,
        inputs: context.workspace.listInputFilesJustBefore(task.instant),
        timeoutSeconds: SCRIPT_REPLAY_TIMEOUT_SECONDS,
    };
    const response = await executeScriptReplayInContainer(context.settings.storeFolder, request, context.signal, context.settings.containerNamePrefix);
    taskRun.response = response;
    applyResponseToOutcome(outcome, response);
    return taskRun;
}

function readStartText(gap: ReplayGap, commits: InverseCommit[], fileName: string): string | undefined {
    if (gap.olderPosition === undefined) {
        return undefined;
    }
    const olderCommit = commits.find((commit) => commit.position === gap.olderPosition);
    if (olderCommit === undefined) {
        throw new Error(`readStartText: ${fileName} has no commit at the older position ${gap.olderPosition}`);
    }
    if (olderCommit.moment !== StateMoment.AtEvent) {
        throw new Error(`readStartText: the commit at the older position ${gap.olderPosition} of ${fileName} is not an at-event commit`);
    }
    if (olderCommit.isFileAbsent) {
        return undefined;
    }
    return olderCommit.text;
}

function listGapEventsOldestFirst(gap: ReplayGap): FileEvent[] {
    const events: FileEvent[] = [];
    for (const droppedState of [...gap.droppedStates].reverse()) {
        if (!events.includes(droppedState.state.event)) {
            events.push(droppedState.state.event);
        }
    }
    return events;
}

function isGapReplayable(gap: ReplayGap, commits: InverseCommit[], tasksByTaskId: Map<string, ScriptReplayTask>, fileName: string): boolean {
    const firstDroppedPosition = gap.droppedStates[0]!.position;
    if (commits.some((commit) => commit.position === firstDroppedPosition)) {
        return false;
    }
    for (const droppedState of gap.droppedStates) {
        const eventType = droppedState.state.event.type;
        if (eventType === FileEventType.UserEditNotice) {
            return false;
        }
        if (eventType === FileEventType.RowBytesUnknown) {
            return false;
        }
        if (eventType === FileEventType.ScriptMayWrite) {
            if (!tasksByTaskId.has(getScriptTaskId(droppedState.state.event))) {
                return false;
            }
        }
    }
    const newerCommit = commits.find((commit) => commit.position === gap.newerPosition);
    if (newerCommit === undefined) {
        throw new Error(`isGapReplayable: ${fileName} has no commit at the newer position ${gap.newerPosition}`);
    }
    return !isGapHalfDropped(gap, newerCommit);
}

function createActiveGap(fileIndex: number, gapOrder: number, gap: ReplayGap, startText: string | undefined): ActiveGap {
    return { fileIndex, gapOrder, gap, events: listGapEventsOldestFirst(gap), runningText: startText, textsByEvent: new Map(), isFailed: false };
}

function collectActiveGaps(context: ReplayContext, statesByFile: FileKnownState[][]): ActiveGap[] {
    const { settings } = context;
    const activeGaps: ActiveGap[] = [];
    for (const [fileIndex, projectFile] of settings.projectFiles.entries()) {
        const fileName = basename(projectFile.file.toString());
        const repoFolder = getInverseRepoFolderForFile(settings.storeFolder, settings.projectFolder, projectFile.file);
        const commits = listInverseCommits(repoFolder, fileName);
        const gaps = listReplayGapsFromStates(statesByFile[fileIndex]!);
        for (const [gapOrder, gap] of gaps.entries()) {
            if (isGapReplayable(gap, commits, context.tasksByTaskId, fileName)) {
                activeGaps.push(createActiveGap(fileIndex, gapOrder, gap, readStartText(gap, commits, fileName)));
            }
        }
        const bornless = readReplayGapsSidecar(repoFolder).bornless;
        if (bornless !== null) {
            let bornGapOrder = gaps.length;
            for (const task of context.tasks) {
                const isBirthCandidate = task.waitingFiles.some((waitingFile) => waitingFile.relativePath === context.relativePaths[fileIndex] && waitingFile.reason === ScriptReplayTaskReason.BirthCandidate);
                if (isBirthCandidate) {
                    activeGaps.push(createActiveGap(fileIndex, bornGapOrder, buildBornGap(bornless, task.record), undefined));
                    bornGapOrder += 1;
                }
            }
        }
    }
    return activeGaps;
}

function listStepsInTimeOrder(activeGaps: ActiveGap[]): ReplayStep[] {
    const steps: ReplayStep[] = [];
    for (const activeGap of activeGaps) {
        for (const [eventIndex, event] of activeGap.events.entries()) {
            steps.push({ activeGap, event, instant: getEventInstant(event), isLastStep: eventIndex === activeGap.events.length - 1 });
        }
    }
    steps.sort((firstStep, secondStep) => {
        const instantDifference = firstStep.instant.getTime() - secondStep.instant.getTime();
        if (instantDifference !== 0) {
            return instantDifference;
        }
        if (firstStep.activeGap.fileIndex !== secondStep.activeGap.fileIndex) {
            return firstStep.activeGap.fileIndex - secondStep.activeGap.fileIndex;
        }
        return firstStep.activeGap.gapOrder - secondStep.activeGap.gapOrder;
    });
    return steps;
}

function markGapFailed(context: ReplayContext, activeGap: ActiveGap): void {
    activeGap.isFailed = true;
    context.workspace.clearInPassTexts(context.settings.projectFiles[activeGap.fileIndex]!.file);
}

function writeFinishedGap(context: ReplayContext, activeGap: ActiveGap): void {
    const { settings, workspace } = context;
    const file = settings.projectFiles[activeGap.fileIndex]!.file;
    const textByPosition = new Map<number, string | undefined>();
    for (const droppedState of activeGap.gap.droppedStates) {
        const texts = activeGap.textsByEvent.get(droppedState.state.event)!;
        if (droppedState.state.moment === StateMoment.AtEvent) {
            textByPosition.set(droppedState.position, texts.after);
        } else {
            textByPosition.set(droppedState.position, texts.before);
        }
    }
    const repoFolder = getInverseRepoFolderForFile(settings.storeFolder, settings.projectFolder, file);
    const report = writeReplayedGapIntoInverseRepo(repoFolder, basename(file.toString()), activeGap.gap, textByPosition);
    workspace.refreshRepo(file);
    workspace.clearInPassTexts(file);
    const relativePath = context.relativePaths[activeGap.fileIndex]!;
    for (const event of activeGap.events) {
        if (event.type === FileEventType.ScriptMayWrite) {
            const fileOutcome = context.taskRunsByTaskId.get(getScriptTaskId(event))!.outcome.files.find((candidate) => candidate.relativePath === relativePath);
            if (fileOutcome === undefined) {
                throw new Error(`writeFinishedGap: the task of ${event.instant?.toISOString()} does not list ${relativePath} as a waiting file`);
            }
            fileOutcome.isGapFilled = true;
            fileOutcome.confidence = report.confidence;
        }
    }
    if (activeGap.gap.kind === ReplayGapKind.Born) {
        context.bornFileIndexes.add(activeGap.fileIndex);
    }
}

async function applyStep(context: ReplayContext, step: ReplayStep): Promise<void> {
    const { activeGap, event } = step;
    if (activeGap.isFailed) {
        return;
    }
    if (activeGap.gap.kind === ReplayGapKind.Born) {
        if (context.bornFileIndexes.has(activeGap.fileIndex)) {
            markGapFailed(context, activeGap);
            return;
        }
    }
    const textBefore = activeGap.runningText;
    let textAfter = textBefore;
    let isStepFailed = false;
    switch (event.type) {
        case FileEventType.EditRow: {
            const editRow = getEditRowOfEvent(event);
            if (isEditApplicableForward(textBefore, editRow)) {
                textAfter = applyEditToText(textBefore, editRow);
            } else {
                isStepFailed = true;
            }
            break;
        }
        case FileEventType.ScriptMayWrite: {
            const taskRun = await executeTaskOnce(context, context.tasksByTaskId.get(getScriptTaskId(event))!);
            if (taskRun.outcome.outcome === ScriptTaskOutcomeKind.Replayed) {
                const relativePath = context.relativePaths[activeGap.fileIndex];
                const changedFile = taskRun.response!.changedFiles.find((candidate) => candidate.relativePath === relativePath);
                if (changedFile !== undefined) {
                    if (changedFile.isNotText) {
                        isStepFailed = true;
                    }
                    textAfter = changedFile.text ?? undefined;
                }
            } else {
                isStepFailed = true;
            }
            break;
        }
        case FileEventType.ScriptReadOnly:
        case FileEventType.ReadPartial:
        case FileEventType.OtherRow:
            break;
        case FileEventType.UserEditNotice:
        case FileEventType.RowBytesUnknown:
            isStepFailed = true;
            break;
        default:
            throw new Error(`applyStep: no rule for the event type ${event.type}`);
    }
    if (activeGap.gap.kind === ReplayGapKind.Born) {
        // A born gap is accepted only when this script made the file.
        if (textAfter === undefined) {
            isStepFailed = true;
        }
    }
    if (isStepFailed) {
        markGapFailed(context, activeGap);
        return;
    }
    activeGap.textsByEvent.set(event, { before: textBefore, after: textAfter });
    activeGap.runningText = textAfter;
    context.workspace.recordTextAfterStep(context.settings.projectFiles[activeGap.fileIndex]!.file, step.instant, textAfter);
    if (step.isLastStep) {
        writeFinishedGap(context, activeGap);
    }
}

function listOutcomesInTaskOrder(context: ReplayContext): ScriptTaskOutcome[] {
    return context.tasks.map((task) => {
        const taskRun = context.taskRunsByTaskId.get(task.record.taskId);
        if (taskRun !== undefined) {
            return taskRun.outcome;
        }
        const outcome = createTaskOutcome(task);
        outcome.reason = NOT_NEEDED_REASON;
        return outcome;
    });
}

export async function replayScriptTasksForProject(settings: ScriptReplaySettings, toInstant: Date, reportProgress: ProgressSink, signal: AbortSignal): Promise<ScriptTaskOutcome[]> {
    const dockerReadiness = checkDockerReadiness();
    if (dockerReadiness !== DockerReadiness.Ready) {
        throw new Error(`replayScriptTasksForProject: docker is not ready: ${dockerReadiness}`);
    }
    if (Number.isNaN(toInstant.getTime())) {
        throw new Error("replayScriptTasksForProject: toInstant is not a valid date");
    }
    const tasks = listScriptReplayTasks(settings.storeFolder, settings.projectFolder, settings.projectFiles, settings.recordedProjectFolder, toInstant);
    if (tasks.length === 0) {
        return [];
    }
    const context: ReplayContext = {
        settings,
        workspace: new ReplayWorkspace(settings.storeFolder, settings.projectFolder, settings.recordedProjectFolder, settings.projectFiles),
        signal,
        reportProgress,
        tasks,
        tasksByTaskId: new Map(tasks.map((task) => [task.record.taskId, task])),
        taskRunsByTaskId: new Map(),
        relativePaths: settings.projectFiles.map((projectFile) => formatSlashPath(settings.projectFolder, projectFile.file)),
        bornFileIndexes: new Set(),
    };
    const statesByFile = listKnownStatesForProjectFiles(settings.projectFiles, settings.jsonlsFolders, settings.snapshotFolders);
    const steps = listStepsInTimeOrder(collectActiveGaps(context, statesByFile));
    for (const step of steps) {
        signal.throwIfAborted();
        await applyStep(context, step);
    }
    return listOutcomesInTaskOrder(context);
}

const USAGE = "usage: node engineV3_script_replay_run.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder> [--recorded-project <folder>] [--up-to <ISO instant>] [--list-only] | --clean --store <folder>";

enum ScriptReplayCommandKind { Run = "run", ListOnly = "list-only", Clean = "clean" }

type ScriptReplayCommand = {
    kind: ScriptReplayCommandKind;
    storeFolder: Path;
    projectFolder: Path;
    jsonlsFolder: Path;
    fileHistoryFolder: Path;
    recordedProjectFolder: Path;
    toInstant: Date;
};

function readRequiredValueFlag(argumentList: string[], flag: string): { value: string; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    return { value, rest };
}

function readScriptReplayCommandFromArguments(argumentList: string[]): ScriptReplayCommand {
    const storeFlag = readRequiredValueFlag(argumentList, "--store");
    const storeFolder = new Path(storeFlag.value);
    if (argumentList.includes("--clean")) {
        return { kind: ScriptReplayCommandKind.Clean, storeFolder, projectFolder: storeFolder, jsonlsFolder: storeFolder, fileHistoryFolder: storeFolder, recordedProjectFolder: storeFolder, toInstant: new Date() };
    }
    const projectFlag = readRequiredValueFlag(storeFlag.rest, "--project");
    const jsonlsFlag = readRequiredValueFlag(projectFlag.rest, "--jsonls");
    const fileHistoryFlag = readRequiredValueFlag(jsonlsFlag.rest, "--file-history");
    const recordedProjectFlag = extractValueFlag(fileHistoryFlag.rest, "--recorded-project");
    const upToFlag = extractValueFlag(recordedProjectFlag.rest, "--up-to");
    let toInstant = new Date();
    if (upToFlag.value !== undefined) {
        toInstant = new Date(upToFlag.value);
        if (Number.isNaN(toInstant.getTime())) {
            throw new Error(`--up-to is not a valid instant: ${upToFlag.value}`);
        }
    }
    let kind = ScriptReplayCommandKind.Run;
    if (argumentList.includes("--list-only")) {
        kind = ScriptReplayCommandKind.ListOnly;
    }
    return {
        kind,
        storeFolder,
        projectFolder: new Path(projectFlag.value),
        jsonlsFolder: new Path(jsonlsFlag.value),
        fileHistoryFolder: new Path(fileHistoryFlag.value),
        recordedProjectFolder: new Path(recordedProjectFlag.value ?? projectFlag.value),
        toInstant,
    };
}

function removeScriptReplayStore(storeFolder: Path, containerNamePrefix: string = SCRIPT_REPLAY_CONTAINER_PREFIX): number {
    const resolvedCacheFolder = resolve(INVERSE_REPOS_CACHE_FOLDER);
    if (!resolve(storeFolder.toString()).startsWith(resolvedCacheFolder + "/")) {
        throw new Error(`removeScriptReplayStore: ${storeFolder.toString()} is not inside the cache folder ${resolvedCacheFolder}`);
    }
    rmSync(storeFolder.toString(), { recursive: true, force: true });
    return removeScriptReplayContainers(containerNamePrefix);
}

function printOutcomeLines(outcomes: ScriptTaskOutcome[]): void {
    for (const outcome of outcomes) {
        console.log(`${outcome.outcome} ${outcome.taskId}${outcome.reason === null ? "" : `: ${outcome.reason}`}`);
        for (const fileOutcome of outcome.files) {
            console.log(`  ${fileOutcome.relativePath} change=${fileOutcome.changeKind} confidence=${fileOutcome.confidence} filled=${fileOutcome.isGapFilled}`);
        }
    }
}

function printMissingExecutableLines(outcomes: ScriptTaskOutcome[]): void {
    const missingNames = new Set<string>();
    for (const outcome of outcomes) {
        if (outcome.missingExecutable !== null) {
            missingNames.add(outcome.missingExecutable);
        }
    }
    for (const missingName of missingNames) {
        console.log(formatMissingExecutableLine(missingName));
    }
}

export async function executeScriptReplayCommandLine(argumentList: string[], containerNamePrefix?: string): Promise<void> {
    const command = readScriptReplayCommandFromArguments(argumentList);
    if (command.kind === ScriptReplayCommandKind.Clean) {
        const removedContainerCount = removeScriptReplayStore(command.storeFolder, containerNamePrefix);
        console.log(`removed ${command.storeFolder.toString()} and ${removedContainerCount} containers`);
        return;
    }
    const projectFiles = listProjectFilesOnDiskAndInLogs(command.projectFolder, [command.jsonlsFolder]);
    const fileNames = projectFiles.map((projectFile) => relative(command.projectFolder.toString(), projectFile.file.toString()));
    buildInverseReposForFiles(command.projectFolder, projectFiles, [command.jsonlsFolder], [command.fileHistoryFolder], command.storeFolder, new Date(), createTerminalBarsSink(process.stdout, fileNames));
    const settings: ScriptReplaySettings = {
        projectFolder: command.projectFolder,
        recordedProjectFolder: command.recordedProjectFolder,
        projectFiles,
        jsonlsFolders: [command.jsonlsFolder],
        snapshotFolders: [command.fileHistoryFolder],
        storeFolder: command.storeFolder,
        containerNamePrefix,
    };
    if (command.kind === ScriptReplayCommandKind.ListOnly) {
        for (const task of listScriptReplayTasks(settings.storeFolder, settings.projectFolder, settings.projectFiles, settings.recordedProjectFolder, command.toInstant)) {
            console.log(`${task.record.instant} ${task.record.taskId} ${task.waitingFiles.map((waitingFile) => waitingFile.relativePath).join(" ")}`);
        }
        return;
    }
    const outcomes = await replayScriptTasksForProject(settings, command.toInstant, (event) => console.log(event.label), new AbortController().signal);
    printOutcomeLines(outcomes);
    printMissingExecutableLines(outcomes);
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
    await executeScriptReplayCommandLine(process.argv.slice(2));
}
