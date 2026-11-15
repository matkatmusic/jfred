// Script replay routes: GET /api/layer1-docker-readiness, POST /api/layer1-script-replay-needs and POST /api/layer1-script-replay-run.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { relative, sep } from "node:path";
import { StateConfidence } from "../engineV3/engineV3_file_known_states.ts";
import { listProjectFilesOnDiskAndInLogs } from "../engineV3/engineV3_inverse_repos_project_files.ts";
import { DockerReadiness, ScriptReplayChangeKind, checkDockerReadiness } from "../engineV3/engineV3_script_replay_container.ts";
import { ScriptTaskOutcomeKind, replayScriptTasksForProject, type ScriptTaskFileOutcome, type ScriptTaskOutcome } from "../engineV3/engineV3_script_replay_run.ts";
import { ScriptReplayTaskReason, listScriptReplayTasks, type ScriptReplayTask } from "../engineV3/engineV3_script_replay_tasks.ts";
import { WireScriptReplayProblem, WireScriptReplayReason, type WireDockerReadiness, type WireScriptReplayFile, type WireScriptReplayNeeds, type WireScriptReplayNeedsRequest, type WireScriptReplayRunReply, type WireScriptReplayRunRequest, type WireScriptReplayTask, type WireScriptReplayTaskResult } from "../webapp/layer1-wire-script-replay.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { ScriptExecutorKind } from "./reconstruction_script_execution.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { assertLocalJsonPost } from "./viewer_api_clear_results.ts";
import { getInverseReposStoreFolder } from "./viewer_api_layer1_inverse_repos.ts";
import { validateExistingFolderParam, sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { sendNdjsonAsync } from "./viewer_api_layer1_route_async.ts";
import { sendJson, sendText } from "./viewer_server_routes.ts";

export const SCRIPT_REPLAY_PROGRESS_LABEL_READING_SIDECARS = "reading script sidecars";
export const SCRIPT_REPLAY_ALREADY_RUNNING_TEXT = "a script replay is already running";
export const SCRIPT_REPLAY_NOT_ALLOWED_TEXT = "scripts are not allowed: allowScripts must be true";

type WireChangeKind = NonNullable<WireScriptReplayFile["changeKind"]>;
export type ScriptReplayRun = (toInstant: Date, reportProgress: ProgressSink, signal: AbortSignal) => Promise<ScriptTaskOutcome[]>;

const WIRE_OUTCOME_BY_KIND: Record<ScriptTaskOutcomeKind, WireRunOutcome> = {
    [ScriptTaskOutcomeKind.Replayed]: WireRunOutcome.replayed,
    [ScriptTaskOutcomeKind.Refused]: WireRunOutcome.notReplayed,
    [ScriptTaskOutcomeKind.Failed]: WireRunOutcome.replayFailed,
};

const WIRE_REASON_BY_REASON: Record<ScriptReplayTaskReason, WireScriptReplayReason> = {
    [ScriptReplayTaskReason.NamedByFile]: WireScriptReplayReason.namedByFile,
    [ScriptReplayTaskReason.BirthCandidate]: WireScriptReplayReason.birthCandidate,
};

const WIRE_LANGUAGE_BY_EXECUTOR_KIND: Record<ScriptExecutorKind, WireScriptReplayTask["language"]> = {
    [ScriptExecutorKind.python]: "python",
    [ScriptExecutorKind.bash]: "bash",
};

const WIRE_CHANGE_KIND_BY_CHANGE_KIND: Record<ScriptReplayChangeKind, WireChangeKind> = {
    [ScriptReplayChangeKind.Changed]: "changed",
    [ScriptReplayChangeKind.Created]: "created",
    [ScriptReplayChangeKind.Deleted]: "deleted",
};

let isScriptReplayRunning = false;

export function buildDockerReadinessReply(readiness: DockerReadiness): WireDockerReadiness {
    if (readiness === DockerReadiness.NotInstalled) {
        return { problem: WireScriptReplayProblem.dockerNotInstalled, problemText: "Docker is not installed. Install Docker, start it, then try again." };
    }
    if (readiness === DockerReadiness.NotRunning) {
        return { problem: WireScriptReplayProblem.dockerNotRunning, problemText: "Docker is not running. Start Docker, then try again." };
    }
    if (readiness === DockerReadiness.ImageMissing) {
        return { problem: WireScriptReplayProblem.imageMissing, problemText: 'The script image is missing. Run "npm run sandbox:build" in the jfred folder once, then try again.' };
    }
    return {};
}

export function receiveDockerReadiness(request: IncomingMessage, response: ServerResponse, url: URL): void {
    const reply = buildDockerReadinessReply(checkDockerReadiness());
    sendJson(response, 200, reply);
}

function formatSlashPath(projectFolder: Path, file: Path): string {
    return relative(projectFolder.toString(), file.toString()).split(sep).join("/");
}

function isInstantAfter(instant: Date, fromInstant: Date | undefined): boolean {
    if (fromInstant === undefined) {
        return true;
    }
    return instant.getTime() > fromInstant.getTime();
}

function mapScriptReplayTaskToWire(task: ScriptReplayTask, fromInstant: Date | undefined): WireScriptReplayTask {
    return {
        taskId: task.record.taskId,
        instant: task.instant.toISOString(),
        isInSpan: isInstantAfter(task.instant, fromInstant),
        code: task.record.code,
        cwd: task.record.cwd,
        language: WIRE_LANGUAGE_BY_EXECUTOR_KIND[task.record.executorKind],
        source: { filePath: task.record.jsonlPath, lineNumber: task.record.line },
        waitingFiles: task.waitingFiles.map((waitingFile) => ({ path: waitingFile.relativePath, reason: WIRE_REASON_BY_REASON[waitingFile.reason] })),
    };
}

// listScriptReplayTasks has no progress hook, so the per-file lines go out before its one call.
function reportSidecarProgress(projectFolder: Path, projectFiles: { file: Path }[], reportProgress: ProgressSink): void {
    reportProgress({ kind: DocumentResponseKind.progress, label: SCRIPT_REPLAY_PROGRESS_LABEL_READING_SIDECARS, current: 0, total: projectFiles.length, steps: [SCRIPT_REPLAY_PROGRESS_LABEL_READING_SIDECARS] });
    for (const [index, projectFile] of projectFiles.entries()) {
        reportProgress({ kind: DocumentResponseKind.progress, label: SCRIPT_REPLAY_PROGRESS_LABEL_READING_SIDECARS, current: index + 1, total: projectFiles.length, file: formatSlashPath(projectFolder, projectFile.file) });
    }
}

export function buildScriptReplayNeedsReply(projectFolder: Path, jsonlsFolders: Path[], request: WireScriptReplayNeedsRequest, reportProgress: ProgressSink, readiness: DockerReadiness = checkDockerReadiness()): WireScriptReplayNeeds {
    const projectFiles = listProjectFilesOnDiskAndInLogs(projectFolder, jsonlsFolders);
    reportSidecarProgress(projectFolder, projectFiles, reportProgress);
    const storeFolder = getInverseReposStoreFolder(projectFolder);
    const tasks = listScriptReplayTasks(storeFolder, projectFolder, projectFiles, projectFolder, new Date(request.toInstant));
    const fromInstant = request.fromInstant === null ? undefined : new Date(request.fromInstant);
    return { ...buildDockerReadinessReply(readiness), tasks: tasks.map((task) => mapScriptReplayTaskToWire(task, fromInstant)) };
}

function mapConfidenceToWire(confidence: StateConfidence | null): WireScriptReplayFile["confidence"] {
    if (confidence === StateConfidence.Proven) {
        return "proven";
    }
    if (confidence === StateConfidence.Derived) {
        return "derived";
    }
    return null;
}

function mapChangeKindToWire(changeKind: ScriptReplayChangeKind | null): WireScriptReplayFile["changeKind"] {
    if (changeKind === null) {
        return null;
    }
    return WIRE_CHANGE_KIND_BY_CHANGE_KIND[changeKind];
}

function mapScriptTaskFileOutcomeToWire(fileOutcome: ScriptTaskFileOutcome): WireScriptReplayFile {
    return {
        path: fileOutcome.relativePath,
        changeKind: mapChangeKindToWire(fileOutcome.changeKind),
        confidence: mapConfidenceToWire(fileOutcome.confidence),
        isGapFilled: fileOutcome.isGapFilled,
    };
}

// A null reason, exit code or missing executable leaves the wire field absent.
export function mapScriptTaskOutcomeToWire(outcome: ScriptTaskOutcome): WireScriptReplayTaskResult {
    const result: WireScriptReplayTaskResult = {
        taskId: outcome.taskId,
        outcome: WIRE_OUTCOME_BY_KIND[outcome.outcome],
        timedOut: outcome.timedOut,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        files: outcome.files.map(mapScriptTaskFileOutcomeToWire),
    };
    if (outcome.reason !== null) {
        result.reason = outcome.reason;
    }
    if (outcome.exitCode !== null) {
        result.exitCode = outcome.exitCode;
    }
    if (outcome.missingExecutable !== null) {
        result.missingExecutable = outcome.missingExecutable;
    }
    return result;
}

export function createScriptReplayRun(projectFolder: Path, jsonlsFolders: Path[], snapshotFolders: Path[]): ScriptReplayRun {
    return (toInstant, reportProgress, signal) => {
        const projectFiles = listProjectFilesOnDiskAndInLogs(projectFolder, jsonlsFolders);
        const storeFolder = getInverseReposStoreFolder(projectFolder);
        const settings = { projectFolder, recordedProjectFolder: projectFolder, projectFiles, jsonlsFolders, snapshotFolders, storeFolder };
        return replayScriptTasksForProject(settings, toInstant, reportProgress, signal);
    };
}

async function replayAndBuildRunReply(runReplay: ScriptReplayRun, request: WireScriptReplayRunRequest, reportProgress: ProgressSink, signal: AbortSignal): Promise<WireScriptReplayRunReply> {
    const outcomes = await runReplay(new Date(request.toInstant), reportProgress, signal);
    return { results: outcomes.map(mapScriptTaskOutcomeToWire) };
}

// The one-run flag is set before the first await, so a second request in the same tick is refused.
export async function sendScriptReplayRunReply(response: ServerResponse, request: WireScriptReplayRunRequest, runReplay: ScriptReplayRun): Promise<void> {
    if (request.allowScripts !== true) {
        sendText(response, 400, SCRIPT_REPLAY_NOT_ALLOWED_TEXT);
        return;
    }
    if (isScriptReplayRunning) {
        sendText(response, 400, SCRIPT_REPLAY_ALREADY_RUNNING_TEXT);
        return;
    }
    isScriptReplayRunning = true;
    try {
        await sendNdjsonAsync(response, (writeLine, signal) => replayAndBuildRunReply(runReplay, request, writeLine, signal));
    }
    finally {
        isScriptReplayRunning = false;
    }
}

function assertInstantText(value: unknown, name: string): string {
    if (typeof value !== "string") {
        throw new Error(`body must hold ${name} as an ISO instant text`);
    }
    if (Number.isNaN(Date.parse(value))) {
        throw new Error(`${name} is not a valid instant: ${value}`);
    }
    return value;
}

function parseNeedsRequest(body: string): WireScriptReplayNeedsRequest {
    const parsed = JSON.parse(body) as Partial<WireScriptReplayNeedsRequest>;
    const toInstant = assertInstantText(parsed.toInstant, "toInstant");
    if (parsed.fromInstant === null) {
        return { fromInstant: null, toInstant };
    }
    return { fromInstant: assertInstantText(parsed.fromInstant, "fromInstant"), toInstant };
}

function parseRunRequest(body: string): WireScriptReplayRunRequest {
    const parsed = JSON.parse(body) as Partial<WireScriptReplayRunRequest>;
    return { toInstant: assertInstantText(parsed.toInstant, "toInstant"), allowScripts: parsed.allowScripts === true };
}

function sendNeedsForBody(response: ServerResponse, projectFolder: Path, jsonlsFolders: Path[], body: string): void {
    let needsRequest: WireScriptReplayNeedsRequest;
    try {
        needsRequest = parseNeedsRequest(body);
    }
    catch (error) {
        sendText(response, 400, String(error));
        return;
    }
    sendNdjsonBuild(response, (writeLine) => buildScriptReplayNeedsReply(projectFolder, jsonlsFolders, needsRequest, writeLine));
}

function sendRunForBody(response: ServerResponse, runReplay: ScriptReplayRun, body: string): void {
    let runRequest: WireScriptReplayRunRequest;
    try {
        runRequest = parseRunRequest(body);
    }
    catch (error) {
        sendText(response, 400, String(error));
        return;
    }
    void sendScriptReplayRunReply(response, runRequest, runReplay);
}

// A bad content type, Host or dir throws before the body is read: the server answers 400.
export function receiveScriptReplayNeeds(request: IncomingMessage, response: ServerResponse, url: URL): void {
    assertLocalJsonPost(request);
    const projectFolder = validateExistingFolderParam(url.searchParams, "dir");
    const jsonlsFolders = url.searchParams.getAll("jsonl").map((jsonlFolder) => new Path(jsonlFolder));
    let body = "";
    function appendChunk(chunk: Buffer): void {
        body += chunk.toString();
    }
    function sendNeedsAnswer(): void {
        sendNeedsForBody(response, projectFolder, jsonlsFolders, body);
    }
    request.on("data", appendChunk);
    request.on("end", sendNeedsAnswer);
}

export function receiveScriptReplayRun(request: IncomingMessage, response: ServerResponse, url: URL): void {
    assertLocalJsonPost(request);
    const projectFolder = validateExistingFolderParam(url.searchParams, "dir");
    const jsonlsFolders = url.searchParams.getAll("jsonl").map((jsonlFolder) => new Path(jsonlFolder));
    const snapshotFolders = url.searchParams.getAll("snapshots").map((snapshotsFolder) => new Path(snapshotsFolder));
    let body = "";
    function appendChunk(chunk: Buffer): void {
        body += chunk.toString();
    }
    function sendRunAnswer(): void {
        sendRunForBody(response, createScriptReplayRun(projectFolder, jsonlsFolders, snapshotFolders), body);
    }
    request.on("data", appendChunk);
    request.on("end", sendRunAnswer);
}
