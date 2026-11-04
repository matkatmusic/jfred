// The one place that writes the docker command for a replayed script.

import { spawnSync } from "node:child_process";
import { Path, Uuid } from "./structures/domain.ts";

export const SANDBOX_IMAGE = "python:3.14-slim";
export const DEFAULT_SANDBOX_MOUNT = new Path("/work");

export class DockerUnavailableError extends Error {
  constructor() {
    super(`Docker is off or the image ${SANDBOX_IMAGE} is missing`);
  }
}

export function buildDockerRunArgs(runId: Uuid, tempDir: Path, mount: Path): string[] {
  return [
    "run", "--rm", "--pull", "never", "--network", "none",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "1g",
    "--name", runId.toString(),
    "-v", `${tempDir}:${mount}`, "-w", mount.toString(),
    SANDBOX_IMAGE, "python3", "__script__.py",
  ];
}

// A colon would make `-v` read the rest of the cwd as a mode or a second path.
export function chooseSandboxMount(recordedCwd: Path | undefined): Path {
  if (recordedCwd === undefined) {
    return DEFAULT_SANDBOX_MOUNT;
  }
  if (recordedCwd.toString().includes(":")) {
    throw new Error(`The recorded cwd holds a colon, so docker -v would misread it: ${recordedCwd}`);
  }
  return recordedCwd;
}

export const DOCKER_CONTROL_TIMEOUT_MS = 10000;

export class DockerStuckError extends Error {
  constructor() {
    super("Docker is stuck: the script container never started. Restart Docker Desktop.");
  }
}

export function killSandboxContainer(runId: Uuid, timeoutMs = DOCKER_CONTROL_TIMEOUT_MS): void {
  const result = spawnSync("docker", ["kill", runId.toString()], { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" });
  const isContainerEnded = /No such container|is not running/.test(result.stderr);
  if (result.status !== 0 && !isContainerEnded) {
    throw new Error(`docker kill ${runId} failed: ${result.stderr || result.error}`);
  }
}

// "No such object" means --rm already removed the container, so it goes on to the kill.
export function stopTimedOutContainer(runId: Uuid, timeoutMs = DOCKER_CONTROL_TIMEOUT_MS): void {
  const result = spawnSync("docker", ["inspect", "--format", "{{.State.Status}}", runId.toString()], { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" });
  if (result.error !== undefined) {
    throw new Error(`docker inspect ${runId} failed: ${result.error}`);
  }
  if (result.stdout.trim() === "created") {
    throw new DockerStuckError();
  }
  killSandboxContainer(runId, timeoutMs);
}

export function assertSandboxImagePresent(): void {
  const result = spawnSync("docker", ["image", "inspect", SANDBOX_IMAGE], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new DockerUnavailableError();
  }
}
