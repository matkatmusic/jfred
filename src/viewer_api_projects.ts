// Runtime projects-dir and file-history-dir switching, plus per-project path overrides.

import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveSiblingFileHistoryRoot,
  getDefaultFileHistoryRoot,
} from "./reconstruction_sidecar_reader.ts";
import {
  buildProjectPaths,
  buildProjectSources,
  readProjectPathsConfig,
  setPathOverrides,
  type WireProjectPaths,
} from "./reconstruction_overrides.ts";
import { Path } from "./structures/domain.ts";

// Scan root, no default: --projects-dir required. item 46: let activeProjectsDir = new Path(join(homedir(), ".claude", "projects"));
let activeProjectsDir: Path | undefined;

export function getProjectsDir(): Path {
  if (activeProjectsDir === undefined) {
    throw new Error("projects dir not set: start the server with --projects-dir <path>");
  }
  return activeProjectsDir;
}

// Existence-only validation; localhost trust boundary needs no authorization check.
export function setProjectsDir(requested: string): Path {
  const stats = statSync(requested, { throwIfNoEntry: false });
  const isDirectory = stats?.isDirectory();
  if (!isDirectory) {
    throw new Error(`not a directory: ${requested}`);
  }
  activeProjectsDir = new Path(resolve(requested));
  // item 46: folder switch re-derives the file-history root.
  activeFileHistoryDir = undefined;
  return activeProjectsDir;
}

// item 46: folder-level file-history override; undefined derives from the projects folder.
let activeFileHistoryDir: Path | undefined;

// Empty string clears override; non-directory throws (400). Returns effective dir.
export function setFileHistoryDir(requested: string): Path {
  if (requested === "") {
    activeFileHistoryDir = undefined;
    return getEffectiveFileHistoryDir();
  }
  const stats = statSync(requested, { throwIfNoEntry: false });
  const isDirectory = stats?.isDirectory();
  if (!isDirectory) {
    throw new Error(`not a directory: ${requested}`);
  }
  activeFileHistoryDir = new Path(resolve(requested));
  return activeFileHistoryDir;
}

// Resolution chain: explicit override, then sibling dir, then ~/.claude default.
export function getEffectiveFileHistoryDir(): Path {
  return activeFileHistoryDir
        ?? (activeProjectsDir === undefined ? undefined : deriveSiblingFileHistoryRoot(activeProjectsDir))
        ?? getDefaultFileHistoryRoot();
}

// task 137: session-only overrides; client posts full field set each time, {} clears.
const sessionProjectPaths = new Map<string, WireProjectPaths>();

export function setSessionProjectPaths(projectName: string, entry: WireProjectPaths): void {
  sessionProjectPaths.set(projectName, entry);
}

// Stored reveng-paths.json entry with session overrides merged on top.
export function getMergedProjectPaths(projectName: string): WireProjectPaths {
  return { ...readProjectPathsConfig(getProjectsDir())[projectName], ...sessionProjectPaths.get(projectName) };
}

// item 46: sets process-wide engine path overrides per request; call before build.
export function applyProjectOverrides(projectName: string): void {
  const wireEntry = getMergedProjectPaths(projectName);
  const overrides = buildProjectPaths(wireEntry);
  // Spec S6: multi-source record stream needs per-source blob resolution.
  if (wireEntry.sources !== undefined) {
    overrides.sources = buildProjectSources(getProjectsDir(), wireEntry);
  }
  if (overrides.fileHistoryRoot === undefined) {
    overrides.fileHistoryRoot = getEffectiveFileHistoryDir();
  }
  setPathOverrides(overrides);
}
