// Runs one recorded script in a locked-down docker container. The only host mount is the store, read-only.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
    DOCKER_CONTROL_TIMEOUT_MS,
    DockerUnavailableError,
    SANDBOX_IMAGE,
    assertMountPathSafe,
    killSandboxContainer,
    stopTimedOutContainer,
} from "../src/reconstruction_script_sandbox_docker.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

export enum DockerReadiness {
    Ready = "ready",
    NotInstalled = "docker-not-installed",
    NotRunning = "docker-not-running",
    ImageMissing = "image-missing",
}
export enum ScriptInterpreter { Python = "python3", Bash = "bash" }
export enum ScriptReplayInputKind { Store = "store", Text = "text" }
export enum ScriptReplayChangeKind { Changed = "changed", Created = "created", Deleted = "deleted" }

export type ScriptReplayInputSource =
    | { kind: ScriptReplayInputKind.Store; repoRelativePath: string; commitHash: string }
    | { kind: ScriptReplayInputKind.Text; text: string };
export type ScriptReplayInputFile = { relativePath: string; source: ScriptReplayInputSource };
export type ScriptReplayRequest = {
    projectRoot: string;
    cwd: string;
    pythonImportFolder: string;
    interpreter: ScriptInterpreter;
    source: string;
    inputs: ScriptReplayInputFile[];
    timeoutSeconds: number;
};
export type ScriptReplayChangedFile = { relativePath: string; changeKind: ScriptReplayChangeKind; text: string | null; isNotText: boolean };
export type ScriptReplayResponse = { exitCode: number; timedOut: boolean; stdout: string; stderr: string; changedFiles: ScriptReplayChangedFile[]; missingExecutable: string | null };

export const SCRIPT_REPLAY_CONTAINER_PREFIX = "jfred-replay-";
export const SCRIPT_REPLAY_STORE_MOUNT = "/store";
export const SCRIPT_REPLAY_USER = "1000:1000";
export const SCRIPT_REPLAY_TIMEOUT_SECONDS = 60;

const WRAPPER_FILE_NAME = "engineV3_script_replay_wrapper.py";
const NO_PROGRAM_ERROR_CODE = "ENOENT";
const DOCKER_FAILURE_STATUS = 125;
const BACKSTOP_EXTRA_SECONDS = 10;

export function checkDockerReadiness(): DockerReadiness {
    const versionResult = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: DOCKER_CONTROL_TIMEOUT_MS });
    const spawnError = versionResult.error as NodeJS.ErrnoException | undefined;
    if (spawnError?.code === NO_PROGRAM_ERROR_CODE) {
        return DockerReadiness.NotInstalled;
    }
    if (versionResult.status !== 0) {
        return DockerReadiness.NotRunning;
    }
    const imageResult = spawnSync("docker", ["image", "inspect", SANDBOX_IMAGE], { timeout: DOCKER_CONTROL_TIMEOUT_MS });
    if (imageResult.status !== 0) {
        return DockerReadiness.ImageMissing;
    }
    return DockerReadiness.Ready;
}

function assertRequestIsSafe(storeFolder: Path, request: ScriptReplayRequest): void {
    assertMountPathSafe(storeFolder, "The store folder");
    assertMountPathSafe(new Path(request.projectRoot), "The project root");
    if (request.projectRoot.includes(",")) {
        throw new Error(`The project root holds a comma, so docker --tmpfs would misread it: ${request.projectRoot}`);
    }
    for (const input of request.inputs) {
        if (isAbsolute(input.relativePath)) {
            throw new Error(`Input path is absolute: ${input.relativePath}`);
        }
        if (input.relativePath.split("/").includes("..")) {
            throw new Error(`Input path holds a .. segment: ${input.relativePath}`);
        }
    }
}

// A listener cannot throw to the caller, so a failed stop rejects the promise instead.
function createStopFailure(containerName: string, signal: AbortSignal, backstopSeconds: number, finished: AbortSignal): Promise<never> {
    const containerId = new Uuid(containerName);
    return new Promise((_resolve, reject) => {
        const stopOnAbort = () => {
            try {
                killSandboxContainer(containerId);
                reject(new Error("script replay was aborted"));
            } catch (error) {
                reject(error);
            }
        };
        const stopOnBackstop = () => {
            try {
                stopTimedOutContainer(containerId);
                reject(new Error(`script replay container did not stop after ${backstopSeconds} seconds`));
            } catch (error) {
                reject(error);
            }
        };
        signal.addEventListener("abort", stopOnAbort, { once: true, signal: finished });
        AbortSignal.timeout(backstopSeconds * 1000).addEventListener("abort", stopOnBackstop, { once: true, signal: finished });
    });
}

async function waitForDockerClose(child: ReturnType<typeof spawn>): Promise<number | null> {
    try {
        const [status] = await once(child, "close");
        return status;
    } catch (error) {
        const spawnError = error as NodeJS.ErrnoException;
        if (spawnError.code === NO_PROGRAM_ERROR_CODE) {
            throw new DockerUnavailableError();
        }
        throw error;
    }
}

export async function executeScriptReplayInContainer(storeFolder: Path, request: ScriptReplayRequest, signal: AbortSignal, containerNamePrefix: string = SCRIPT_REPLAY_CONTAINER_PREFIX): Promise<ScriptReplayResponse> {
    assertRequestIsSafe(storeFolder, request);
    signal.throwIfAborted();
    const containerName = `${containerNamePrefix}${randomUUID()}`;
    const dockerArguments = buildScriptReplayDockerArguments(containerName, storeFolder, request.projectRoot);
    const child = spawn("docker", dockerArguments, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => { stdout += text; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => { stderr += text; });
    const stdinFailure = new Promise<never>((_resolve, reject) => child.stdin.on("error", reject));
    child.stdin.end(JSON.stringify(request));
    const finished = new AbortController();
    const stopFailure = createStopFailure(containerName, signal, request.timeoutSeconds + BACKSTOP_EXTRA_SECONDS, finished.signal);
    let status: number | null;
    try {
        status = await Promise.race([waitForDockerClose(child), stopFailure, stdinFailure]);
    } finally {
        finished.abort();
    }
    if (status === DOCKER_FAILURE_STATUS) {
        throw new DockerUnavailableError();
    }
    if (status !== 0) {
        throw new Error(`script replay wrapper failed with exit status ${status}: ${stderr}`);
    }
    return JSON.parse(stdout) as ScriptReplayResponse;
}

export function removeScriptReplayContainers(containerNamePrefix: string = SCRIPT_REPLAY_CONTAINER_PREFIX): number {
    // The ^/ anchor stops the prefix from matching a longer name that merely holds it (docker stores names as /name).
    const listResult = spawnSync("docker", ["ps", "-aq", "--filter", `name=^/${containerNamePrefix}`], { encoding: "utf8", timeout: DOCKER_CONTROL_TIMEOUT_MS });
    if (listResult.status !== 0) {
        throw new Error(`docker ps failed: ${listResult.stderr || listResult.error}`);
    }
    const containerIds = listResult.stdout.split("\n").filter((line) => line !== "");
    if (containerIds.length === 0) {
        return 0;
    }
    const removeResult = spawnSync("docker", ["rm", "-f", ...containerIds], { encoding: "utf8", timeout: DOCKER_CONTROL_TIMEOUT_MS });
    if (removeResult.status !== 0) {
        throw new Error(`docker rm failed: ${removeResult.stderr || removeResult.error}`);
    }
    return containerIds.length;
}

export function buildScriptReplayDockerArguments(containerName: string, storeFolder: Path, projectRoot: string): string[] {
    const wrapperSource = readFileSync(join(import.meta.dirname, WRAPPER_FILE_NAME), "utf8");
    return [
        "run", "--rm", "-i", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "1g",
        "--user", SCRIPT_REPLAY_USER, "--name", containerName,
        "-e", "HOME=/tmp/home", "-e", "TMPDIR=/tmp",
        "--tmpfs", "/tmp:rw,nosuid,size=128m,uid=1000,gid=1000,mode=1777",
        "--tmpfs", `${projectRoot}:rw,exec,nosuid,size=256m,uid=1000,gid=1000,mode=755`,
        "-v", `${storeFolder}:${SCRIPT_REPLAY_STORE_MOUNT}:ro`,
        SANDBOX_IMAGE, "python3", "-I", "-c", wrapperSource,
    ];
}
