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

export function killSandboxContainer(runId: Uuid): void {
  const result = spawnSync("docker", ["kill", runId.toString()], { encoding: "utf8" });
  const isContainerEnded = /No such container|is not running/.test(result.stderr);
  if (result.status !== 0 && !isContainerEnded) {
    throw new Error(`docker kill ${runId} failed: ${result.stderr || result.error}`);
  }
}

export function assertSandboxImagePresent(): void {
  const result = spawnSync("docker", ["image", "inspect", SANDBOX_IMAGE], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new DockerUnavailableError();
  }
}
