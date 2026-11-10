// Task 358 part S: runs one script in Docker with live output, a timeout and a cancel.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Path, Uuid } from "./structures/domain.ts";
import { ReconstructionCounter, addToReconstructionCounter } from "./reconstruction_counters.ts";
import type { SandboxOutput } from "./reconstruction_script_sandbox_memo.ts";
import type { SandboxBox } from "./reconstruction_script_sandbox_box.ts";
import { SANDBOX_TIMEOUT_MS, locateReadOnlyScript, prepareSandboxDirectory, readAllFiles, removeSandboxDirectory } from "./reconstruction_script_sandbox_dir.ts";
import { applyStdoutRedirect, collectBoxPostState, collectSandboxFileHashes } from "./reconstruction_script_sandbox_snapshot.ts";
import {
  DockerUnavailableError,
  type DockerLaunch,
  buildDockerRunArgs,
  chooseSandboxMount,
  killSandboxContainer,
  stopTimedOutContainer,
} from "./reconstruction_script_sandbox_docker.ts";

const DOCKER_FAILURE_STATUS = 125;
const SPAWN_ERROR_NO_PROGRAM = "ENOENT";
const SCRIPT_FILE_NAME = "__script__.py";

export type OutputStream = "stdout" | "stderr";
export type OutputSink = (stream: OutputStream, text: string) => void;
export type StreamedRun = { post: Map<string, string> | undefined; deletedKeys: string[]; notTextKeys: string[]; output: SandboxOutput; isCancelled: boolean };
type StreamedPost = Pick<StreamedRun, "post" | "deletedKeys" | "notTextKeys">;
type RunState = { output: SandboxOutput; isCancelled: boolean };
type BoxRun = { box: SandboxBox; preState: Map<string, string>; baseline: Map<string, string> };
type StopAction = (runId: Uuid, state: RunState) => void;

function collectOutput(child: ChildProcessWithoutNullStreams, output: SandboxOutput, onOutput: OutputSink): void {
  for (const stream of ["stdout", "stderr"] as const) {
    const appendChunk = (text: string) => {
      output[stream] += text;
      onOutput(stream, text);
    };
    child[stream].setEncoding("utf8");
    child[stream].on("data", appendChunk);
  }
}

function convertSpawnError(error: NodeJS.ErrnoException): Error {
  return error.code === SPAWN_ERROR_NO_PROGRAM ? new DockerUnavailableError() : error;
}

function stopCancelledRun(runId: Uuid, state: RunState): void {
  state.isCancelled = true;
  killSandboxContainer(runId);
}

function stopTimedOutRun(runId: Uuid, state: RunState): void {
  state.output.timedOut = true;
  stopTimedOutContainer(runId);
}

// A listener cannot throw to the caller, so a failed stop rejects the stop promise instead.
function createStopHandler(stop: StopAction, runId: Uuid, state: RunState, fail: (error: unknown) => void): () => void {
  return () => {
    try {
      stop(runId, state);
    }
    catch (error) {
      fail(error);
    }
  };
}

// The listeners end when `finished` aborts, so a run that exited is never stopped later.
function createStopFailure(runId: Uuid, signal: AbortSignal, timeoutMs: number, state: RunState, finished: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const stopOnCancel = createStopHandler(stopCancelledRun, runId, state, reject);
    const stopOnTimeout = createStopHandler(stopTimedOutRun, runId, state, reject);
    signal.addEventListener("abort", stopOnCancel, { once: true, signal: finished });
    AbortSignal.timeout(timeoutMs).addEventListener("abort", stopOnTimeout, { once: true, signal: finished });
  });
}

async function waitForClose(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  try {
    const [status] = await once(child, "close");
    return status;
  }
  catch (error) {
    throw convertSpawnError(error as NodeJS.ErrnoException);
  }
}

async function waitForExit(child: ChildProcessWithoutNullStreams, runId: Uuid, signal: AbortSignal, timeoutMs: number, state: RunState): Promise<number | null> {
  const finished = new AbortController();
  const stopFailure = createStopFailure(runId, signal, timeoutMs, state, finished.signal);
  try {
    return await Promise.race([waitForClose(child), stopFailure]);
  }
  finally {
    finished.abort();
  }
}

function collectSandboxFiles(tempDir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const [relativePath, content] of readAllFiles(tempDir)) {
    const isScriptFile = relativePath === SCRIPT_FILE_NAME;
    if (!isScriptFile) {
      files.set(relativePath, content);
    }
  }
  return files;
}

// Only a clean exit that was neither timed out nor cancelled yields the files.
function readStreamedPost(status: number | null, state: RunState, tempDir: string, boxRun: BoxRun | undefined): StreamedPost {
  if (status === DOCKER_FAILURE_STATUS) {
    throw new DockerUnavailableError();
  }
  const isCleanExit = status === 0 && !state.output.timedOut && !state.isCancelled;
  if (!isCleanExit) {
    return { post: undefined, deletedKeys: [], notTextKeys: [] };
  }
  if (boxRun === undefined) {
    return { post: collectSandboxFiles(tempDir), deletedKeys: [], notTextKeys: [] };
  }
  applyStdoutRedirect(tempDir, boxRun.box, state.output.stdout);
  return collectBoxPostState(tempDir, boxRun.box, boxRun.preState, boxRun.baseline);
}

function createDockerArgs(runId: Uuid, tempDir: string, recordedCwd: Path | undefined, box: SandboxBox | undefined): string[] {
  if (box === undefined) {
    return buildDockerRunArgs(runId, new Path(tempDir), chooseSandboxMount(recordedCwd));
  }
  const launch: DockerLaunch = { workdir: box.workdir, scriptArgument: box.scriptPath.toString(), readOnlyScript: locateReadOnlyScript(tempDir, box) };
  return buildDockerRunArgs(runId, new Path(tempDir), box.root, launch);
}

export async function executeSandboxStreaming(script: string, preState: Map<string, string>, recordedCwd: Path | undefined, onOutput: OutputSink, signal: AbortSignal, timeoutMs: number = SANDBOX_TIMEOUT_MS, box?: SandboxBox): Promise<StreamedRun> {
  const tempDir = prepareSandboxDirectory(script, preState, box);
  try {
    const boxRun: BoxRun | undefined = box === undefined ? undefined : { box, preState, baseline: collectSandboxFileHashes(tempDir) };
    const runId = new Uuid(randomUUID());
    addToReconstructionCounter(ReconstructionCounter.sandboxSpawns);
    const child = spawn("docker", createDockerArgs(runId, tempDir, recordedCwd, box), { stdio: "pipe" });
    const state: RunState = { output: { stdout: "", stderr: "", timedOut: false }, isCancelled: false };
    collectOutput(child, state.output, onOutput);
    const status = await waitForExit(child, runId, signal, timeoutMs, state);
    return { ...readStreamedPost(status, state, tempDir, boxRun), output: { ...state.output, exitCode: status ?? undefined }, isCancelled: state.isCancelled };
  }
  finally {
    removeSandboxDirectory(tempDir);
  }
}
