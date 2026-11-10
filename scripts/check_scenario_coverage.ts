// Diffs engine-reconstructed steps against captured ground-truth folders.

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { buildStepStates, buildStepChanges, type RepoSnapshot, type StepChange } from "../src/reconstruction_steps.ts";
import { isReproducedBySomeStep } from "../src/reconstruction_step_snapshot.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { mergeMultiSourceRecords, splitRecordsBySession } from "../src/reconstruction_multi_source.ts";
import { getPathOverrides } from "../src/reconstruction_overrides.ts";
import { enableProvenance, disableProvenance, getAndClearProvenance, type ProvenanceEntry } from "../src/reconstruction_provenance.ts";
import { listCoveredScenarios, findUncovered, type CoveredScenario } from "./coverage_scenarios.ts";
import { buildUuidLineIndex } from "./jsonl_uuid_line_index.ts";
import { readStepStateFiles, listStepFolders, parseStepNumber } from "./step_state_files.ts";
import { buildStepMismatch, type StepMismatch } from "./coverage_step_mismatch.ts";
import { printResult, type ScenarioResult } from "./coverage_report.ts";

// Whether any folder after this one is reproduced by an engine step.
function isReproducedLater(steps: RepoSnapshot[], stepStatesDir: string, laterFolders: string[]): boolean {
  for (const later of laterFolders) {
    const laterGroundTruth = readStepStateFiles(join(stepStatesDir, later));
    const isReproduced = isReproducedBySomeStep(steps, laterGroundTruth);
    if (isReproduced) {
      return true;
    }
  }
  return false;
}

// Load a scenario's JSONL records; multi-source captures go through the merge stages (Spec S7c).
function loadScenarioRecords(scenario: CoveredScenario): TranscriptRecord[] {
  const loaded: TranscriptRecord[] = [];
  for (const path of scenario.jsonlPaths) {
    for (const record of loadTranscript(path.toString()).records) {
      loaded.push(record);
    }
  }
  return scenario.sources === undefined
    ? loaded
    : mergeMultiSourceRecords(splitRecordsBySession(loaded), scenario.sources, getPathOverrides());
}

// What the engine produced for one scenario, used to judge each captured folder.
type EngineRun = {
  steps: RepoSnapshot[];
  stepChanges: StepChange[];
  uuidLineIndex: Map<string, number>;
  provenance: ProvenanceEntry[];
};

function buildEngineRun(scenario: CoveredScenario, records: TranscriptRecord[]): EngineRun {
  const reader = buildSidecarReader(records, getPathOverrides(), scenario.sources);
  const uuidLineIndex = buildUuidLineIndex(scenario.jsonlPaths);
  enableProvenance();
  const steps = buildStepStates(records, getPathOverrides(), reader);
  const provenance = getAndClearProvenance();
  disableProvenance();
  const stepChanges = buildStepChanges(records, getPathOverrides(), reader);
  return { steps, stepChanges, uuidLineIndex, provenance };
}

type FolderTally = { passed: number; userEdits: number; mismatches: StepMismatch[] };

// Count one captured folder as reproduced, a user-edit, or a mismatch.
function countFolderOutcome(tally: FolderTally, scenario: CoveredScenario, engineRun: EngineRun, folder: string, laterFolders: string[]): void {
  const groundTruth = readStepStateFiles(join(scenario.stepStatesDir, folder));
  const isReproduced = isReproducedBySomeStep(engineRun.steps, groundTruth);
  if (isReproduced) {
    tally.passed += 1;
    return;
  }
  // ponytail: look-ahead — if a later folder matches an engine step, this folder is a user-edit the transcript coalesced (scenario runner did 2+ Edit: steps between prompts)
  const laterMatches = isReproducedLater(engineRun.steps, scenario.stepStatesDir, laterFolders);
  if (laterMatches) {
    tally.userEdits += 1;
    tally.passed += 1;
    return;
  }
  tally.mismatches.push(buildStepMismatch(parseStepNumber(folder), groundTruth, engineRun.steps, engineRun.stepChanges, engineRun.uuidLineIndex, engineRun.provenance));
}

function compareFoldersToEngineRun(scenario: CoveredScenario, engineRun: EngineRun): ScenarioResult {
  const tally: FolderTally = { passed: 0, userEdits: 0, mismatches: [] };
  const folders = listStepFolders(scenario.stepStatesDir);
  for (let i = 0; i < folders.length; i += 1) {
    countFolderOutcome(tally, scenario, engineRun, folders[i]!, folders.slice(i + 1));
  }
  return { scenario, passed: tally.passed, userEdits: tally.userEdits, total: folders.length, mismatches: tally.mismatches };
}

// Reconstruct a scenario's steps, comparing each captured folder against engine output.
export function validateScenario(scenario: CoveredScenario): ScenarioResult {
  console.log(`\n=== scenario ${scenario.scenarioId} (${scenario.dirName}) ===`);
  const records = loadScenarioRecords(scenario);
  console.log(`   Loaded ${records.length} transcript records from ${scenario.jsonlPaths.length} JSONL files`);
  const engineRun = buildEngineRun(scenario, records);
  return compareFoldersToEngineRun(scenario, engineRun);
}

// Wraps validateScenario so a thrown error becomes an ERROR result instead of aborting the sweep.
export function validateScenarioResilient(scenario: CoveredScenario): ScenarioResult {
  try {
    return validateScenario(scenario);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scenario,
      passed: 0,
      userEdits: 0,
      total: 1,
      mismatches: [{ stepNum: 0, jsonlLine: "(error)", diff: `ERROR: ${message}`, provenance: "" }],
    };
  }
}

// Keep the scenarios whose id or directory name equals the filter; no filter keeps all.
function selectScenariosByFilter(allCovered: CoveredScenario[], filter: string | undefined): CoveredScenario[] {
  const selected: CoveredScenario[] = [];
  for (const scenario of allCovered) {
    const isSelected = filter === undefined || scenario.scenarioId === filter || scenario.dirName === filter;
    if (isSelected) {
      selected.push(scenario);
    }
  }
  return selected;
}

// The first command-line argument that is not a flag, if any.
function findFilterArgument(): string | undefined {
  for (const arg of process.argv.slice(2)) {
    const isFlag = arg.startsWith("--");
    if (!isFlag) {
      return arg;
    }
  }
  return undefined;
}

// Exit 2 when a filter was given and no covered scenario matches it.
function assertFilterMatchedScenario(covered: CoveredScenario[], filter: string | undefined): void {
  const hasNoMatch = covered.length === 0 && filter !== undefined;
  if (hasNoMatch) {
    console.error(`no covered scenario matches "${filter}"`);
    process.exit(2);
  }
}

function validateScenarios(covered: CoveredScenario[]): ScenarioResult[] {
  const results: ScenarioResult[] = [];
  for (const scenario of covered) {
    results.push(validateScenarioResilient(scenario));
  }
  return results;
}

// Print each result (only failing ones when asked) and return the failing results.
function printResultsAndGetFailed(results: ScenarioResult[], onlyFailing: boolean): ScenarioResult[] {
  const failed: ScenarioResult[] = [];
  for (const result of results) {
    const hasMismatches = result.mismatches.length > 0;
    if (hasMismatches) {
      failed.push(result);
    }
    const isHidden = onlyFailing && !hasMismatches;
    if (!isHidden) {
      printResult(result);
    }
  }
  return failed;
}

function printUncoveredScenarios(covered: CoveredScenario[]): void {
  const executedRoot = new URL("../scenarios/executed/", import.meta.url);
  const uncovered = findUncovered(executedRoot, covered);
  console.log(`\nUncovered (no .step_states): ${uncovered.length === 0 ? "none" : uncovered.join(", ")}`);
}

// Sweep covered scenarios, print coverage matrix, exit 1 on failure, exit 2 on no match.
function executeCoverageSweep(): void {
  const onlyFailing = process.argv.includes("--onlyFailing");
  const filter = findFilterArgument();
  const covered = selectScenariosByFilter(listCoveredScenarios(), filter);
  assertFilterMatchedScenario(covered, filter);
  const results = validateScenarios(covered);
  const failed = printResultsAndGetFailed(results, onlyFailing);
  if (filter === undefined) {
    printUncoveredScenarios(covered);
  }
  console.log(`${results.length - failed.length}/${results.length} scenarios fully reproduced.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  executeCoverageSweep();
}
