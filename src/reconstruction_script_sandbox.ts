// Run detection lives in reconstruction_script_execution.ts, pre-execution seeding in reconstruction_script_prestate.ts.

import { Path, Uuid } from "./structures/domain.ts";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import {
  getMemoizedSandboxOutcome,
  storeSandboxOutcome,
  type SandboxOutcome,
  type SandboxOutput,
} from "./reconstruction_script_sandbox_memo.ts";
import { ReconstructionCounter, addToReconstructionCounter } from "./reconstruction_counters.ts";
import { SANDBOX_TIMEOUT_MS, prepareSandboxDirectory, readAllFiles } from "./reconstruction_script_sandbox_dir.ts";
import {
  DockerUnavailableError,
  SANDBOX_IMAGE,
  buildDockerRunArgs,
  chooseSandboxMount,
  killSandboxContainer,
  stopTimedOutContainer,
} from "./reconstruction_script_sandbox_docker.ts";
import { assertSpawnAllowed, reportMemoHit } from "./reconstruction_script_sandbox_spawn_guard.ts";

const SPAWN_ERROR_NO_PROGRAM = "ENOENT";
const SPAWN_ERROR_TIMED_OUT = "ETIMEDOUT";
const SPAWN_ERROR_OUTPUT_TOO_LARGE = "ENOBUFS";
const DOCKER_FAILURE_STATUS = 125;

// The script's first line, capped, so a progress line identifies which run is executing.
function formatScriptForProgress(script: string): string {
  const firstLine = script.split("\n", 1)[0] ?? "";
  if (firstLine.length <= 60) {
    return firstLine;
  }
  return `${firstLine.slice(0, 59)}…`;
}

export const PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX = "running script in sandbox";
export const PROGRESS_LABEL_SANDBOX_MEMO_PREFIX = "reusing sandbox result";

// Python bytecode caches are sandbox artifacts no scenario tracks; canonical filter for all callers.
export function isJunkStateKey(key: string): boolean {
  return key.includes("__pycache__") || key.endsWith(".pyc");
}

// Hashes the script, the Docker image tag, the cwd (it is the mount), and sorted seeded (path, content) pairs.
export function computeSandboxInputKey(script: string, preState: Map<string, string>, recordedCwd?: Path): string {
  const hash = createHash("sha256");
  hash.update(script);
  hash.update("\0runtime\0" + SANDBOX_IMAGE);
  hash.update(recordedCwd === undefined ? "" : "\0cwd\0" + recordedCwd.toString());
  const sortedPaths = [...preState.keys()].sort();
  for (const path of sortedPaths) {
    hash.update("\0");
    hash.update(path);
    hash.update("\0");
    hash.update(preState.get(path)!);
  }
  return hash.digest("hex");
}

function reportMemoizedOutcome(outcome: SandboxOutcome, script: string, sourceLabel: string): Map<string, string> | undefined {
  addToReconstructionCounter(ReconstructionCounter.sandboxMemoHits);
  reportReconstructionProgress(`${PROGRESS_LABEL_SANDBOX_MEMO_PREFIX}${sourceLabel}: ${formatScriptForProgress(script)}`);
  reportMemoHit(script, sourceLabel, outcome.post);
  return outcome.post;
}

export function executeScriptAgainstState(script: string, preState: Map<string, string>, sourceLabel = "", recordedCwd?: Path): Map<string, string> | undefined {
  const inputKey = computeSandboxInputKey(script, preState, recordedCwd);
  const memoizedOutcome = getMemoizedSandboxOutcome(inputKey);
  if (memoizedOutcome !== undefined) {
    return reportMemoizedOutcome(memoizedOutcome, script, sourceLabel);
  }
  const isSpawnAllowed = assertSpawnAllowed(script, sourceLabel);
  if (!isSpawnAllowed) {
    return undefined;
  }
  return spawnAndStoreOutcome(inputKey, script, preState, sourceLabel, recordedCwd);
}

function spawnAndStoreOutcome(inputKey: string, script: string, preState: Map<string, string>, sourceLabel: string, recordedCwd?: Path): Map<string, string> | undefined {
  reportReconstructionProgress(
    `${PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX} (${preState.size} seeded files)${sourceLabel}: ${formatScriptForProgress(script)}`,
  );
  addToReconstructionCounter(ReconstructionCounter.sandboxSpawns);
  const outcome = spawnSandboxRun(script, preState, recordedCwd);
  storeSandboxOutcome(inputKey, outcome.post, outcome.output);
  return outcome.post;
}

// Seeds a temp dir, runs python3 in a closed Docker container, reads back the tree.
function spawnSandboxRun(script: string, preState: Map<string, string>, recordedCwd?: Path): SandboxOutcome {
  const tempDir = prepareSandboxDirectory(script, preState);
  try {
    const runId = new Uuid(randomUUID());
    const dockerArgs = buildDockerRunArgs(runId, new Path(tempDir), chooseSandboxMount(recordedCwd));
    // SIGKILL: python as PID 1 ignores the SIGTERM docker forwards, so the timeout would never end the wait.
    const result = spawnSync("docker", dockerArgs, { timeout: SANDBOX_TIMEOUT_MS, killSignal: "SIGKILL", stdio: "pipe", encoding: "utf8" });
    return parseSandboxResult(result, runId, tempDir);
  }
  finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectSandboxPostState(tempDir: string): Map<string, string> {
  const post = new Map<string, string>();
  for (const [relativePath, content] of readAllFiles(tempDir)) {
    const isScriptFile = relativePath === "__script__.py";
    if (!isScriptFile) {
      post.set(relativePath, content);
    }
  }
  return post;
}

function parseSandboxResult(result: SpawnSyncReturns<string>, runId: Uuid, tempDir: string): SandboxOutcome {
  const output: SandboxOutput = { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? undefined, timedOut: false };
  if (result.error !== undefined) {
    return parseSpawnError(result.error, output, runId);
  }
  // ponytail: a script calling sys.exit(125) reads as Docker off.
  if (result.status === DOCKER_FAILURE_STATUS) {
    throw new DockerUnavailableError();
  }
  if (result.status !== 0) {
    return { post: undefined, output };
  }
  return { post: collectSandboxPostState(tempDir), output };
}

function parseSpawnError(error: Error, output: SandboxOutput, runId: Uuid): SandboxOutcome {
  const errorCode = (error as NodeJS.ErrnoException).code;
  if (errorCode === SPAWN_ERROR_NO_PROGRAM) {
    throw new DockerUnavailableError();
  }
  if (errorCode === SPAWN_ERROR_TIMED_OUT) {
    stopTimedOutContainer(runId);
    return { post: undefined, output: { ...output, timedOut: true } };
  }
  if (errorCode === SPAWN_ERROR_OUTPUT_TOO_LARGE) {
    killSandboxContainer(runId);
    return { post: undefined, output };
  }
  throw error;
}
