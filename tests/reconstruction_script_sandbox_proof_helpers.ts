import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path, Uuid } from "../src/structures/domain.ts";
import { buildDockerRunArgs, chooseSandboxMount, type DockerLaunch } from "../src/reconstruction_script_sandbox_docker.ts";

export const PROOF_TIMEOUT_MS = 90000;
export const NO_SUCH_FILE = /FileNotFoundError: \[Errno 2\] No such file or directory/;

export interface ProofRun {
  status: number | null;
  stdout: string;
  stderr: string;
  mountDir: string;
}

// Runs a tiny test script through the real docker command; the mount folder is new each time.
export async function runProofScript(script: string, mount: Path = chooseSandboxMount(undefined), seed: [string, string][] = [], launch?: DockerLaunch, prepare?: (mountDir: Path) => void): Promise<ProofRun> {
  const mountDir = mkdtempSync(join(tmpdir(), "reveng-proof-mount-"));
  // prepare runs first, so a clone can fill the empty mount folder.
  if (prepare !== undefined) {
    prepare(new Path(mountDir));
  }
  writeFileSync(join(mountDir, "__script__.py"), script);
  for (const [name, content] of seed) {
    writeFileSync(join(mountDir, name), content);
  }
  const child = spawn("docker", buildDockerRunArgs(new Uuid(`reveng-proof-${randomUUID()}`), new Path(mountDir), mount, launch), { stdio: "pipe" });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { status, stdout, stderr, mountDir };
}

// A host file outside the mount, with its hash taken now.
export function createCanary(): { path: string; hashBefore: string; readHash: () => string } {
  const hostDir = mkdtempSync(join(tmpdir(), "reveng-proof-host-"));
  const path = join(hostDir, "canary.txt");
  writeFileSync(path, `canary ${randomUUID()}\n`);
  const readHash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  return { path, hashBefore: readHash(), readHash };
}
