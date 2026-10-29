// Diffs engine-reconstructed steps against captured ground-truth folders.

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { buildStepStates, buildStepChanges, type RepoSnapshot } from "../src/reconstruction_steps.ts";
import { isReproducedBySomeStep } from "../src/reconstruction_step_snapshot.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { mergeMultiSourceRecords, splitRecordsBySession } from "../src/reconstruction_multi_source.ts";
import { enableProvenance, disableProvenance, getAndClearProvenance } from "../src/reconstruction_provenance.ts";
import { listCoveredScenarios, findUncovered, buildUuidLineIndex, readStepStateFiles, stepFolders, stepNumberOf, type CoveredScenario } from "./coverage_scenarios.ts";
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

// Reconstruct a scenario's steps, comparing each captured folder against engine output.
export function validateScenario(scenario: CoveredScenario): ScenarioResult {
  console.log(`\n=== scenario ${scenario.scenarioId} (${scenario.dirName}) ===`);
  const loaded: TranscriptRecord[] = [];
  for (const path of scenario.jsonlPaths) {
    for (const record of loadTranscript(path.toString()).records) {
      loaded.push(record);
    }
  }
  // Spec S7c: a multi-source capture routes through the viewer's merge stages + per-source reader.
  const records = scenario.sources === undefined
    ? loaded
    : mergeMultiSourceRecords(splitRecordsBySession(loaded), scenario.sources);
  console.log(`   Loaded ${records.length} transcript records from ${scenario.jsonlPaths.length} JSONL files`);
  const reader = buildSidecarReader(records, scenario.sources);
  const uuidLineIndex = buildUuidLineIndex(scenario.jsonlPaths);
  enableProvenance();
  const steps = buildStepStates(records, reader);
  const provenance = getAndClearProvenance();
  disableProvenance();
  const stepChanges = buildStepChanges(records, reader);
  const mismatches: StepMismatch[] = [];
  let passed = 0;
  let userEdits = 0;
  const folders = stepFolders(scenario.stepStatesDir);
  for (let i = 0; i < folders.length; i += 1) {
    const groundTruth = readStepStateFiles(join(scenario.stepStatesDir, folders[i]!));
    const isReproduced = isReproducedBySomeStep(steps, groundTruth);
    if (isReproduced) {
      passed += 1;
      continue;
    }
    // ponytail: look-ahead — if a later folder matches an engine step, this folder is a user-edit the transcript coalesced (scenario runner did 2+ Edit: steps between prompts)
    const laterMatches = isReproducedLater(steps, scenario.stepStatesDir, folders.slice(i + 1));
    if (laterMatches) {
      userEdits += 1;
      passed += 1;
      continue;
    }
    mismatches.push(
      buildStepMismatch(stepNumberOf(folders[i]!), groundTruth, steps, stepChanges, uuidLineIndex, provenance),
    );
  }
  return { scenario, passed, userEdits, total: folders.length, mismatches };
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

// Sweep covered scenarios, print coverage matrix, exit 1 on failure, exit 2 on no match.
function executeCoverageSweep(): void {
  const executedRoot = new URL("../scenarios/executed/", import.meta.url);
  const onlyFailing = process.argv.includes("--onlyFailing");
  let filter: string | undefined;
  for (const arg of process.argv.slice(2)) {
    const isFlag = arg.startsWith("--");
    if (!isFlag) {
      filter = arg;
      break;
    }
  }
  const covered = selectScenariosByFilter(listCoveredScenarios(), filter);
  const hasNoMatch = covered.length === 0 && filter !== undefined;
  if (hasNoMatch) {
    console.error(`no covered scenario matches "${filter}"`);
    process.exit(2);
  }
  const results: ScenarioResult[] = [];
  for (const scenario of covered) {
    results.push(validateScenarioResilient(scenario));
  }
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
  if (filter === undefined) {
    const uncovered = findUncovered(executedRoot, covered);
    console.log(`\nUncovered (no .step_states): ${uncovered.length === 0 ? "none" : uncovered.join(", ")}`);
  }
  console.log(`${results.length - failed.length}/${results.length} scenarios fully reproduced.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  executeCoverageSweep();
}
