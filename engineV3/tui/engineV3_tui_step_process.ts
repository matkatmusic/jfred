// The real child processes behind the terminal UI: spawn, read every chunk, map the result line, keep the live-child registry.

import { spawn, type ChildProcess } from "node:child_process";
import type { Path } from "../../src/structures/domain.ts";
import { getRelativePathInProject } from "../engineV3_inverse_repos_for_project.ts";
import { removeLockFileOfThisProcessAtExit, setLockFileToRemoveAtExit } from "./engineV3_tui_exit_lock.ts";
import { computePlayOutcome, computeStepOutcome, type ChildResult } from "./engineV3_tui_step_outcome.ts";
import type { PlayOutcome, PlayRequest, SpawnPlayProcess, SpawnSettings, SpawnStepProcess, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";

type LiveChild = { child: ChildProcess; file: Path | undefined };

const STANDARD_ERROR_TAIL_LINE_COUNT = 20;
const PLAY_STANDARD_INPUT_TEXT = "f\nr\nq\n";

const liveChildren = new Map<number, LiveChild>();
let isExitHandlerRegistered = false;

function endAllProcessGroupsAtExit(): void {
    for (const childId of liveChildren.keys()) {
        process.kill(-childId, "SIGTERM");
    }
    removeLockFileOfThisProcessAtExit();
}

function ensureExitHandlerIsRegistered(): void {
    if (!isExitHandlerRegistered) {
        process.on("exit", endAllProcessGroupsAtExit);
        isExitHandlerRegistered = true;
    }
}

export function registerLockFileForExit(lockFile: Path): void {
    setLockFileToRemoveAtExit(lockFile);
    ensureExitHandlerIsRegistered();
}

function isNonEmptyLine(line: string): boolean {
    return line !== "";
}

function listNonEmptyLines(text: string): string[] {
    return text.split("\n").filter(isNonEmptyLine);
}

// The exit code of the child already reports why the pipe broke.
function ignoreBrokenStandardInput(): void {}

function spawnChildProcess(command: string, args: string[], workingFolder: Path, standardInputText: string | undefined, file: Path | undefined): Promise<ChildResult> {
    const child = spawn(command, args, { cwd: workingFolder.toString(), detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const childId = child.pid!;
    liveChildren.set(childId, { child, file });
    ensureExitHandlerIsRegistered();
    let standardOutputText = "";
    let standardErrorText = "";
    function appendStandardOutput(chunk: string): void {
        standardOutputText += chunk;
    }
    function appendStandardError(chunk: string): void {
        standardErrorText = (standardErrorText + chunk).split("\n").slice(-(STANDARD_ERROR_TAIL_LINE_COUNT + 1)).join("\n");
    }
    function forgetChild(): void {
        liveChildren.delete(childId);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", appendStandardOutput);
    child.stderr.on("data", appendStandardError);
    child.stdin.on("error", ignoreBrokenStandardInput);
    child.once("exit", forgetChild);
    child.stdin.end(standardInputText);
    function waitForClose(resolve: (result: ChildResult) => void): void {
        function resolveWithResult(exitCode: number | null, signal: NodeJS.Signals | null): void {
            const stderrTail = listNonEmptyLines(standardErrorText).slice(-STANDARD_ERROR_TAIL_LINE_COUNT).join("\n");
            resolve({ exitCode, signal, stdoutLines: listNonEmptyLines(standardOutputText), stderrTail });
        }
        child.once("close", resolveWithResult);
    }
    return new Promise(waitForClose);
}

function buildChildArguments(settings: SpawnSettings, file: Path, modeArguments: string[]): string[] {
    const childArguments = ["--import", "tsx", "engineV3/engineV3_inverse_repos_for_project.ts", "--project", settings.projectFolder.toString(), "--jsonls", settings.jsonlsFolders.join(","), "--file-history", settings.fileHistoryFolders.join(","), "--store", settings.storeFolder.toString(), "--step", getRelativePathInProject(settings.projectFolder, file), ...modeArguments];
    if (settings.earliestBoundary !== undefined) {
        childArguments.push("--repo", settings.earliestBoundary.repoFolder.toString(), "--commit", settings.earliestBoundary.commit.toString());
    }
    return childArguments;
}

export async function runStepChild(command: string, args: string[], workingFolder: Path, file: Path | undefined = undefined): Promise<StepProcessOutcome> {
    const result = await spawnChildProcess(command, args, workingFolder, undefined, file);
    return computeStepOutcome(result);
}

export function createSpawnStepProcess(settings: SpawnSettings): SpawnStepProcess {
    function spawnStepProcess(request: StepRequest): Promise<StepProcessOutcome> {
        const modeArguments = ["--startAt", request.startAt.toISOString()];
        if (request.isPassingStops) {
            modeArguments.push("--pass-stops");
        }
        return runStepChild(process.execPath, buildChildArguments(settings, request.file, modeArguments), settings.jfredFolder, request.file);
    }
    return spawnStepProcess;
}

export function createSpawnPlayProcess(settings: SpawnSettings): SpawnPlayProcess {
    async function spawnPlayProcess(request: PlayRequest): Promise<PlayOutcome> {
        const childArguments = buildChildArguments(settings, request.file, ["--no-walk-other-files"]);
        const result = await spawnChildProcess(process.execPath, childArguments, settings.jfredFolder, PLAY_STANDARD_INPUT_TEXT, request.file);
        return computePlayOutcome(result);
    }
    return spawnPlayProcess;
}

export function listLiveChildProcessIds(): number[] {
    return [...liveChildren.keys()];
}

function endLiveChild(liveChild: LiveChild): Promise<void> {
    function waitForExit(resolve: () => void): void {
        function resolveOnExit(): void {
            resolve();
        }
        liveChild.child.once("exit", resolveOnExit);
    }
    const exited = new Promise<void>(waitForExit);
    process.kill(-liveChild.child.pid!, "SIGTERM");
    return exited;
}

export async function endChildOfFile(file: Path): Promise<void> {
    for (const liveChild of liveChildren.values()) {
        if (liveChild.file?.equals(file)) {
            await endLiveChild(liveChild);
            return;
        }
    }
}

export async function endAllLiveChildren(): Promise<void> {
    await Promise.all([...liveChildren.values()].map(endLiveChild));
}
