// Task 358 part S: runs one script in Docker with live output, a timeout and a cancel.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { Path, Uuid } from "./structures/domain.ts";
import { ReconstructionCounter, addToReconstructionCounter } from "./reconstruction_counters.ts";
import type { SandboxOutput } from "./reconstruction_script_sandbox_memo.ts";
import { SANDBOX_TIMEOUT_MS, prepareSandboxDirectory, readAllFiles } from "./reconstruction_script_sandbox_dir.ts";
import {
  DockerUnavailableError,
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
export type StreamedRun = { post: Map<string, string> | undefined; output: SandboxOutput; isCancelled: boolean };
type RunState = { output: SandboxOutput; isCancelled: boolean };
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
function readStreamedPost(status: number | null, state: RunState, tempDir: string): Map<string, string> | undefined {
  if (status === DOCKER_FAILURE_STATUS) {
    throw new DockerUnavailableError();
  }
  const isCleanExit = status === 0 && !state.output.timedOut && !state.isCancelled;
  return isCleanExit ? collectSandboxFiles(tempDir) : undefined;
}

export async function executeSandboxStreaming(script: string, preState: Map<string, string>, recordedCwd: Path | undefined, onOutput: OutputSink, signal: AbortSignal, timeoutMs: number = SANDBOX_TIMEOUT_MS): Promise<StreamedRun> {
  const tempDir = prepareSandboxDirectory(script, preState);
  try {
    const runId = new Uuid(randomUUID());
    addToReconstructionCounter(ReconstructionCounter.sandboxSpawns);
    const child = spawn("docker", buildDockerRunArgs(runId, new Path(tempDir), chooseSandboxMount(recordedCwd)), { stdio: "pipe" });
    const state: RunState = { output: { stdout: "", stderr: "", timedOut: false }, isCancelled: false };
    collectOutput(child, state.output, onOutput);
    const status = await waitForExit(child, runId, signal, timeoutMs, state);
    return { post: readStreamedPost(status, state, tempDir), output: { ...state.output, exitCode: status ?? undefined }, isCancelled: state.isCancelled };
  }
  finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
