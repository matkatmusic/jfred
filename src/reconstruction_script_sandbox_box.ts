// One object that says where a replayed script runs, what runs, and which project files it sees.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import { parseStdoutRedirect, type ParsedRedirect } from "./reconstruction_bash_events.ts";
import { DEFAULT_SANDBOX_MOUNT, assertMountPathSafe } from "./reconstruction_script_sandbox_docker.ts";
import { findCommitBeforeRun, findRepoRoot, isGitRepository } from "./reconstruction_script_sandbox_project.ts";

const INLINE_SCRIPT_FILE_NAME = "__script__.py";

export interface SandboxBox {
  // Where the temp folder appears in the box.
  root: Path;
  // The recorded cwd, or the root.
  workdir: Path;
  // The absolute path python runs.
  scriptPath: Path;
  stdoutRedirect: ParsedRedirect | undefined;
  project: { repo: Path; commit: Uuid } | undefined;
}

function isInsideFolder(folder: Path, candidate: Path): boolean {
  const relativePath = relative(folder.toString(), candidate.toString());
  if (relativePath === "..") {
    return false;
  }
  if (relativePath.startsWith("../")) {
    return false;
  }
  return !isAbsolute(relativePath);
}

function expandHomeFolder(typedPath: string): string {
  if (typedPath === "~") {
    return homedir();
  }
  if (typedPath.startsWith("~/")) {
    return resolve(homedir(), typedPath.slice(2));
  }
  return typedPath;
}

export function buildSandboxBox(run: ScriptRun, repo: Path | undefined): SandboxBox {
  const hasGitRepo = repo !== undefined && isGitRepository(repo);
  const repoRoot = hasGitRepo ? findRepoRoot(repo) : undefined;
  const commit = hasGitRepo ? findCommitBeforeRun(repo, run.timestamp, run.gitBranch) : undefined;
  const project = repoRoot !== undefined && commit !== undefined ? { repo: repoRoot, commit } : undefined;

  let root = DEFAULT_SANDBOX_MOUNT;
  if (repoRoot !== undefined) {
    root = repoRoot;
  }
  if (run.cwd !== undefined) {
    root = run.cwd;
    if (repoRoot !== undefined) {
      if (isInsideFolder(repoRoot, run.cwd)) {
        root = repoRoot;
      }
    }
  }
  const workdir = run.cwd ?? root;

  const typedScriptPath = run.invokedScriptPath;
  const scriptPath = typedScriptPath === undefined
    ? new Path(resolve(workdir.toString(), INLINE_SCRIPT_FILE_NAME))
    : new Path(resolve(workdir.toString(), expandHomeFolder(typedScriptPath)));

  assertMountPathSafe(root, "The box root");
  assertMountPathSafe(workdir, "The box workdir");
  if (!isInsideFolder(root, scriptPath)) {
    assertMountPathSafe(scriptPath, "The script path");
  }

  const stdoutRedirect = run.invokedCommand === undefined ? undefined : parseStdoutRedirect(run.invokedCommand);
  return { root, workdir, scriptPath, stdoutRedirect, project };
}

// ponytail: process-wide scope like the spawn guard; builds are synchronous.
let activeRepo: Path | undefined;

export function executeInRealBox<T>(repo: Path, compute: () => T): T {
  const previousRepo = activeRepo;
  activeRepo = repo;
  try {
    return compute();
  }
  finally {
    activeRepo = previousRepo;
  }
}

// Undefined outside executeInRealBox: those callers keep today's box.
export function resolveRunBox(run: ScriptRun): SandboxBox | undefined {
  if (activeRepo === undefined) {
    return undefined;
  }
  return buildSandboxBox(run, activeRepo);
}

export function describeSandboxBoxKey(box: SandboxBox): string {
  return JSON.stringify({
    root: box.root,
    workdir: box.workdir,
    scriptPath: box.scriptPath,
    stdoutRedirect: box.stdoutRedirect ?? null,
    project: box.project ?? null,
  });
}
