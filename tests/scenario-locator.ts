import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { listCoveredScenarios } from "../scripts/coverage_scenarios.ts";

// The repo's scenarios submodule checkout, derived from this file's location.
export const SCENARIO_ROOTS = [
  fileURLToPath(new URL("../scenarios/executed", import.meta.url)),
] as const;

function listJsonlNames(dir: string): string[] {
  const names = readdirSync(dir);
  const jsonlNames: string[] = [];
  for (const name of names) {
    const isJsonl = name.endsWith(".jsonl");
    if (isJsonl) {
      jsonlNames.push(name);
    }
  }
  jsonlNames.sort();
  return jsonlNames;
}

// Finds a scenario's transcript by dir name; throws when no root holds the dir.
export function findScenarioJsonl(dirName: string): string {
  for (const root of SCENARIO_ROOTS) {
    const dir = join(root, dirName);
    let jsonls: string[];
    try {
      jsonls = listJsonlNames(dir);
    }
    catch {
      continue;
    }
    if (jsonls.length > 0) {
      return join(dir, jsonls[0]!);
    }
  }
  throw new Error(`scenario ${dirName}: no .jsonl found under known roots`);
}

// Lives here, not utilities.ts, so utilities stays free of scenario captures.
export function findScenarioDir(roots: readonly string[], dirName: string): string {
  for (const root of roots) {
    const dir = join(root, dirName);
    let jsonls: string[];
    try {
      jsonls = listJsonlNames(dir);
    }
    catch {
      continue;
    }
    if (jsonls.length > 0) {
      return dir;
    }
  }
  throw new Error(`scenario ${dirName}: no directory with .jsonl found under known roots`);
}

// The transcript JSONLs directly inside a scenario directory, sorted by file name.
export function listScenarioJsonlPaths(dir: Path): Path[] {
  const names = listJsonlNames(dir.value);
  const paths: Path[] = [];
  for (const name of names) {
    paths.push(new Path(join(dir.value, name)));
  }
  return paths;
}

// Throws when the scenario id is not captured, so a missing ground truth fails loudly.
export function getScenarioJsonlPaths(scenarioId: string): Path[] {
  const scenarios = listCoveredScenarios();
  for (const covered of scenarios) {
    if (covered.scenarioId === scenarioId) {
      return covered.jsonlPaths;
    }
  }
  throw new Error(`no covered scenario with id ${scenarioId}`);
}
