// Runs git for the jfred branch writes: one runner that cannot land in another repo.

import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { Path } from "./structures/domain.ts";

// Git variables that would point a spawned git at another repo or index.
const REPO_POINTER_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_PREFIX"];

export interface JfredGitOptions {
  input?: string;
  env?: Record<string, string>;
}

function buildCleanEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of REPO_POINTER_VARIABLES) {
    delete environment[name];
  }
  return { ...environment, ...extra };
}

export function runJfredGit(repoDir: Path, args: string[], options: JfredGitOptions = {}): string {
  if (!isAbsolute(repoDir.toString()))
    throw new Error(`jfred git needs an absolute repo path: ${repoDir.toString()}`);
  const result = spawnSync("git", args, {
    cwd: repoDir.toString(),
    env: buildCleanEnvironment(options.env ?? {}),
    input: options.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`git ${args[0]} failed in ${repoDir.toString()}: ${result.stderr}`);
  return result.stdout.trim();
}
