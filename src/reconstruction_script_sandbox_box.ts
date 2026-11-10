// One object that says where a replayed script runs, what runs, and which project files it sees.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import type { ScriptRun } from "./reconstruction_script_execution.ts";
import { parseStdoutRedirect, type ParsedRedirect } from "./reconstruction_bash_events.ts";
import { DEFAULT_SANDBOX_MOUNT, assertMountPathSafe } from "./reconstruction_script_sandbox_docker.ts";
import { findCommitBeforeRun, findRepoRoot, isInsideGitWorkTree } from "./reconstruction_script_sandbox_project.ts";

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
  const isParentRelative = relativePath.startsWith("../");
  if (isParentRelative) {
    return false;
  }
  return !isAbsolute(relativePath);
}

function normalizeHomeFolder(typedPath: string): string {
  if (typedPath === "~") {
    return homedir();
  }
  const isHomeRelative = typedPath.startsWith("~/");
  if (isHomeRelative) {
    return resolve(homedir(), typedPath.slice(2));
  }
  return typedPath;
}

function assertRepoFolderInsideGitRepository(repo: Path | undefined): void {
  if (repo !== undefined) {
    const isRepoInsideWorkTree = isInsideGitWorkTree(repo);
    if (!isRepoInsideWorkTree) {
      throw new Error(`repo folder ${repo.toString()} is not inside a git repository`);
    }
  }
}

function findBoxRoot(run: ScriptRun, repoRoot: Path | undefined): Path {
  if (run.cwd === undefined) {
    return repoRoot ?? DEFAULT_SANDBOX_MOUNT;
  }
  if (repoRoot !== undefined) {
    const isCwdInsideRepo = isInsideFolder(repoRoot, run.cwd);
    if (isCwdInsideRepo) {
      return repoRoot;
    }
  }
  return run.cwd;
}

function findScriptPath(run: ScriptRun, workdir: Path): Path {
  const typedScriptPath = run.invokedScriptPath;
  if (typedScriptPath === undefined) {
    return new Path(resolve(workdir.toString(), INLINE_SCRIPT_FILE_NAME));
  }
  return new Path(resolve(workdir.toString(), normalizeHomeFolder(typedScriptPath)));
}

function assertBoxPathsSafe(root: Path, workdir: Path, scriptPath: Path): void {
  assertMountPathSafe(root, "The box root");
  assertMountPathSafe(workdir, "The box workdir");
  const isScriptInsideRoot = isInsideFolder(root, scriptPath);
  if (!isScriptInsideRoot) {
    assertMountPathSafe(scriptPath, "The script path");
  }
}

export function buildSandboxBox(run: ScriptRun, repo: Path | undefined): SandboxBox {
  assertRepoFolderInsideGitRepository(repo);
  const repoRoot = repo === undefined ? undefined : findRepoRoot(repo);
  const commit = repo === undefined ? undefined : findCommitBeforeRun(repo, run.timestamp, run.gitBranch);
  const project = repoRoot !== undefined && commit !== undefined ? { repo: repoRoot, commit } : undefined;
  const root = findBoxRoot(run, repoRoot);
  const workdir = run.cwd ?? root;
  const scriptPath = findScriptPath(run, workdir);
  assertBoxPathsSafe(root, workdir, scriptPath);
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

export function computeSandboxBoxKey(box: SandboxBox): string {
  return JSON.stringify({
    root: box.root,
    workdir: box.workdir,
    scriptPath: box.scriptPath,
    stdoutRedirect: box.stdoutRedirect ?? null,
    project: box.project ?? null,
  });
}
