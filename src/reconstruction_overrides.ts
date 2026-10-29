// User-supplied path overrides for file-history blobs, project and git repo; empty state means defaults.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { findSourceEntriesForProjectRoot } from "./reconstruction_repo_discovery.ts";

// The overrides. All optional; an absent field means "use today's default".
export type PathOverrides = {
  fileHistoryRoot?: Path;   // file-history blob root (chain: this → derived sibling → ~/.claude/file-history)
  projectCwd?: Path;        // where the project lives on disk NOW (extra git-evidence repo candidate)
  repoDir?: Path;           // the git repo to read committed blobs from (wins over the transcript-sibling clone)
  baseCommit?: Uuid;        // commit whose tree seeds tier-1 write beacons (requires repoDir)
  sources?: SourceEntry[];  // the project's declared multi-source list (spec S4b/S6); absent = single-source
};

let activePathOverrides: PathOverrides = {};

export function setPathOverrides(overrides: PathOverrides): void {
  activePathOverrides = overrides;
}

export function getPathOverrides(): PathOverrides {
  return activePathOverrides;
}

// Stable cache-stamp string: defined fields in fixed key order, including `sources`; empty state is "{}".
export function formatPathOverrides(): string {
  const { fileHistoryRoot, projectCwd, repoDir, baseCommit, sources } = activePathOverrides;
  const stampedSources = [];
  for (const source of sources ?? []) {
    stampedSources.push({
      projectsDir: source.projectsDir.toString(),
      fileHistoryDir: source.fileHistoryDir?.toString(),
      root: source.root?.toString(),
      repoDir: source.repoDir?.toString(),
      baseCommit: source.baseCommit?.toString(),
    });
  }
  return JSON.stringify({
    fileHistoryRoot: fileHistoryRoot?.toString(),
    projectCwd: projectCwd?.toString(),
    repoDir: repoDir?.toString(),
    baseCommit: baseCommit?.toString(),
    sources: sources === undefined ? undefined : stampedSources,
  });
}

// Per-project config file inside the projects folder; scanProjects ignores it since it lists only dirs and .jsonl files.
export const PROJECT_PATHS_CONFIG_NAME = "reveng-paths.json";

// Wire shape of one `sources` entry: a log folder, optional file-history folder, optional workspace root.
export type WireSourceEntry = {
  projectsDir: string;
  fileHistoryDir?: string;
  root?: string;
  repoDir?: string;
  baseCommit?: string;
};

// Wire shape of one project's entry in reveng-paths.json: fileHistory override plus multi-source list.
export type WireProjectPaths = {
  cwd?: string;
  repo?: string;
  baseCommit?: string;
  fileHistory?: string;
  sources?: WireSourceEntry[];
  // Wizard pre-baseline answer ("1" reconstruct, "0" start at baseline), persisted on Store.
  preBaseline?: string;
};

// One hydrated source: JSONL folder, optional file-history folder, optional workspace root (absent means auto-detect).
export type SourceEntry = {
  projectsDir: Path;
  fileHistoryDir?: Path;
  root?: Path;
  repoDir?: Path;   // task 365: the nested repo this source's git evidence resolves against
  baseCommit?: Uuid; // task 365: the tier-1 beacon commit for repoDir, per-source
};

// A project's sources list (spec S3); task 365: nested-repo auto-discovery wins over the legacy single-source fallback.
export function buildProjectSources(configProjectsDir: Path, wire: WireProjectPaths): SourceEntry[] {
  if (wire.sources === undefined) {
    if (wire.cwd !== undefined) {
      const discoveredSources = findSourceEntriesForProjectRoot(new Path(wire.cwd));
      if (discoveredSources.length > 0) {
        return discoveredSources;
      }
    }
    const legacySource: SourceEntry = { projectsDir: configProjectsDir };
    if (wire.fileHistory !== undefined) {
      legacySource.fileHistoryDir = new Path(wire.fileHistory);
    }
    return [legacySource];
  }
  const sourceEntries: SourceEntry[] = [];
  for (const wireSource of wire.sources) {
    const sourceEntry: SourceEntry = { projectsDir: new Path(wireSource.projectsDir) };
    if (wireSource.fileHistoryDir !== undefined) {
      sourceEntry.fileHistoryDir = new Path(wireSource.fileHistoryDir);
    }
    if (wireSource.root !== undefined) {
      sourceEntry.root = new Path(wireSource.root);
    }
    if (wireSource.repoDir !== undefined) {
      sourceEntry.repoDir = new Path(wireSource.repoDir);
    }
    if (wireSource.baseCommit !== undefined) {
      sourceEntry.baseCommit = new Uuid(wireSource.baseCommit);
    }
    sourceEntries.push(sourceEntry);
  }
  return sourceEntries;
}

// Project dir name -> entry map; {} if missing, malformed JSON throws so typos are never silently ignored.
export function readProjectPathsConfig(projectsDir: Path): Record<string, WireProjectPaths> {
  const configPath = join(projectsDir.toString(), PROJECT_PATHS_CONFIG_NAME);
  const configExists = existsSync(configPath);
  if (!configExists) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, WireProjectPaths>;
}

// Hydration point (coding-req §1: parsing hydrates, never casts): wire strings -> domain objects. Absent wire fields stay absent.
export function buildProjectPaths(wire: WireProjectPaths): PathOverrides {
  const overrides: PathOverrides = {};
  if (wire.cwd !== undefined) {
    overrides.projectCwd = new Path(wire.cwd);
  }
  if (wire.repo !== undefined) {
    overrides.repoDir = new Path(wire.repo);
  }
  if (wire.baseCommit !== undefined) {
    overrides.baseCommit = new Uuid(wire.baseCommit);
  }
  if (wire.fileHistory !== undefined) {
    overrides.fileHistoryRoot = new Path(wire.fileHistory);
  }
  return overrides;
}

// Merge one project's entry into reveng-paths.json field-wise; absent fields keep stored values.
export function writeProjectPathsEntry(projectsDir: Path, projectName: string, entry: WireProjectPaths): void {
  const config = readProjectPathsConfig(projectsDir);
  config[projectName] = { ...config[projectName], ...entry };
  writeFileSync(join(projectsDir.toString(), PROJECT_PATHS_CONFIG_NAME), JSON.stringify(config, null, 4) + "\n");
}

