// Ground-truth IO for one scenario's `.step_states/step-NNN` folders.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isDirectory } from "./coverage_scenarios.ts";

// `.claude` holds harness permission metadata, outside what the engine reconstructs.
const NON_SOURCE_NAMES = new Set(["manifest.json", "__pycache__", ".pytest_cache", ".claude"]);

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const isNonSource = NON_SOURCE_NAMES.has(name);
    if (isNonSource) {
      continue;
    }
    const absolute = join(dir, name);
    found.push(...(isDirectory(absolute) ? listSourceFiles(absolute) : [absolute]));
  }
  return found;
}

// Keyed by path relative to the folder, e.g. "tests/test_x.py".
export function readStepStateFiles(stepDir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const absolute of listSourceFiles(stepDir)) {
    files.set(relative(stepDir, absolute), readFileSync(absolute, "utf8"));
  }
  return files;
}

export function parseStepNumber(folderName: string): number {
  return Number(folderName.slice("step-".length));
}

function compareStepNumbers(a: string, b: string): number {
  return parseStepNumber(a) - parseStepNumber(b);
}

export function listStepFolders(stepStatesDir: string): string[] {
  const stepNames: string[] = [];
  for (const name of readdirSync(stepStatesDir)) {
    const isStepFolder = name.startsWith("step-");
    if (isStepFolder) {
      stepNames.push(name);
    }
  }
  stepNames.sort(compareStepNumbers);
  return stepNames;
}
