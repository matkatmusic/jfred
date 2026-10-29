// Discovery + ground-truth IO for the scenario coverage checker.  Design: plans/i-need-a-script-peppy-twilight.md (Phase 1).

import { readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { SourceEntry } from "../src/reconstruction_overrides.ts";

// Multi-source captures merge several JSONL files via the sidecar reader.
export type CoveredScenario = {
  scenarioId: string;
  dirName: string;
  jsonlPaths: Path[];
  stepStatesDir: string;
  sources?: SourceEntry[];
};

const SCENARIO_ID_PATTERN = /^[a-z]+\d+/;

export function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

// Extracts the scenario id prefix (e.g. "s19") from a directory name.
function parseScenarioId(dirName: string): string {
  const idMatch = dirName.match(SCENARIO_ID_PATTERN);
  return idMatch?.[0] ?? dirName;
}

// Sorted for deterministic order; a split run's sessions all merge into one record stream.
export function listJsonls(dir: string): string[] {
  const entryNames = readdirSync(dir);
  entryNames.sort();
  const jsonlPaths: string[] = [];
  for (const name of entryNames) {
    const isJsonl = name.endsWith(".jsonl");
    if (isJsonl) {
      jsonlPaths.push(join(dir, name));
    }
  }
  return jsonlPaths;
}

// The per-source trees of a multi-source capture; each also holds a sibling `file-history/`.
export function findSourceTrees(dir: string): string[] {
  const treeNames: string[] = [];
  for (const name of readdirSync(dir)) {
    const hasProjectsDir = name.startsWith("source-") && isDirectory(join(dir, name, "projects"));
    if (hasProjectsDir) {
      treeNames.push(name);
    }
  }
  treeNames.sort();
  return treeNames;
}

function listSourceTreeJsonls(dir: string, treeNames: string[]): string[] {
  const jsonlPaths: string[] = [];
  for (const treeName of treeNames) {
    const projectsRoot = join(dir, treeName, "projects");
    const projectNames = readdirSync(projectsRoot);
    projectNames.sort();
    for (const projectName of projectNames) {
      const projectDir = join(projectsRoot, projectName);
      const isProjectDir = isDirectory(projectDir);
      if (isProjectDir) {
        jsonlPaths.push(...listJsonls(projectDir));
      }
    }
  }
  return jsonlPaths;
}

// With `source-*` trees present, flat root jsonls are ignored: they duplicate the sessions.
function collectScenarioInputs(dir: string): { jsonls: string[]; sources?: SourceEntry[] } {
  const treeNames = findSourceTrees(dir);
  if (treeNames.length === 0) {
    return { jsonls: listJsonls(dir) };
  }
  const sources: SourceEntry[] = [];
  for (const treeName of treeNames) {
    sources.push({ projectsDir: new Path(join(dir, treeName, "projects")) });
  }
  return { jsonls: listSourceTreeJsonls(dir, treeNames), sources };
}

// A dir with `.step_states` but no jsonl is logged and skipped: nothing to reconstruct from.
export function findCoveredScenarios(executedRoot: URL): CoveredScenario[] {
  const root = fileURLToPath(executedRoot);
  const covered: CoveredScenario[] = [];
  for (const dirName of readdirSync(root)) {
    const dir = join(root, dirName);
    const stepStatesDir = join(dir, ".step_states");
    const isNotDirectory = !isDirectory(dir);
    const hasNoStepStates = !existsSync(stepStatesDir);
    const isNotCovered = isNotDirectory || hasNoStepStates;
    if (isNotCovered) {
      continue;
    }
    const { jsonls, sources } = collectScenarioInputs(dir);
    if (jsonls.length === 0) {
      console.warn(`skip ${dirName}: no .jsonl transcript`);
      continue;
    }
    const jsonlPaths: Path[] = [];
    for (const jsonl of jsonls) {
      jsonlPaths.push(new Path(jsonl));
    }
    covered.push({ scenarioId: parseScenarioId(dirName), dirName, jsonlPaths, stepStatesDir, sources });
  }
  return covered;
}

// The in-worktree executed root is the default the CLI and tests both check.
export function listCoveredScenarios(): CoveredScenario[] {
  return findCoveredScenarios(new URL("../scenarios/executed/", import.meta.url));
}

// Scenario dirs with a transcript but no `.step_states`, reported as uncovered (informational).
export function findUncovered(executedRoot: URL, covered: CoveredScenario[]): string[] {
  const root = fileURLToPath(executedRoot);
  const coveredDirs = new Set<string>();
  for (const scenario of covered) {
    coveredDirs.add(scenario.dirName);
  }
  const uncovered: string[] = [];
  for (const dirName of readdirSync(root)) {
    const dir = join(root, dirName);
    const isUncoveredDir = isDirectory(dir) && !coveredDirs.has(dirName) && listJsonls(dir).length > 0;
    if (isUncoveredDir) {
      uncovered.push(dirName);
    }
  }
  return uncovered;
}

