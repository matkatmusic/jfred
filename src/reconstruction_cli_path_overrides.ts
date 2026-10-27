import { basename, dirname } from "node:path";
import { Path } from "./structures/domain.ts";
import {
  buildProjectPaths,
  buildProjectSources,
  readProjectPathsConfig,
  setPathOverrides,
  type PathOverrides,
  type SourceEntry,
  type WireProjectPaths,
} from "./reconstruction_overrides.ts";
import { setPreBaselineReconstructionAllowed } from "./reconstruction_base_commit.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";

// The transcript's config entry is the base; direct CLI flags win per-field. fileHistoryRoot arrives only via its flag.
export function applyCliPathOverrides(options: CliOptions): void {
  const projectDir = dirname(options.jsonlPath);
  const entry = readProjectPathsConfig(new Path(dirname(projectDir)))[basename(projectDir)];
  const merged: PathOverrides = entry !== undefined ? buildProjectPaths(entry) : {};
  const sources = buildCliSources(options, entry, projectDir);
  if (sources !== undefined) {
    merged.sources = sources;
  }
  if (options.fileHistoryRoot !== undefined) {
    merged.fileHistoryRoot = options.fileHistoryRoot;
  }
  if (options.projectCwd !== undefined) {
    merged.projectCwd = options.projectCwd;
  }
  if (options.repoDir !== undefined) {
    merged.repoDir = options.repoDir;
  }
  if (options.baseCommit !== undefined) {
    merged.baseCommit = options.baseCommit;
  }
  // Set unconditionally: shared module state must never inherit a prior run's value.
  setPreBaselineReconstructionAllowed(options.preBaseline);
  setPathOverrides(merged);
}

// Multi-root runs get one bare source per distinct projects root, enabling per-source file-history resolution with zero config.
export function buildCliSources(
  options: CliOptions,
  entry: WireProjectPaths | undefined,
  projectDir: string,
): SourceEntry[] | undefined {
  if (entry?.sources !== undefined) {
    return buildProjectSources(new Path(dirname(projectDir)), entry);
  }
  const distinctRoots: string[] = [];
  for (const jsonlPath of options.jsonlPaths) {
    const projectsRoot = dirname(dirname(jsonlPath));
    const isKnownRoot = distinctRoots.includes(projectsRoot);
    if (!isKnownRoot) {
      distinctRoots.push(projectsRoot);
    }
  }
  if (distinctRoots.length <= 1) {
    return undefined;
  }
  const sources: SourceEntry[] = [];
  for (const projectsRoot of distinctRoots) {
    sources.push({ projectsDir: new Path(projectsRoot) });
  }
  return sources;
}
