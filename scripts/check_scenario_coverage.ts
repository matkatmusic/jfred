// Diffs engine-reconstructed steps against captured ground-truth folders.

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import {
    reconstructStepStates,
    reconstructStepChanges,
    stripTrailingNewline,
    snapshotFileText,
    someStepReproduces,
    type RepoSnapshot,
    type StepChange,
} from "../src/reconstruction_steps.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { mergeMultiSourceRecords, groupRecordsBySession } from "../src/reconstruction_multi_source.ts";
import { Path } from "../src/structures/domain.ts";
import {
    enableProvenance,
    disableProvenance,
    drainProvenance,
    type ProvenanceEntry,
} from "../src/reconstruction_provenance.ts";
import {
    listCoveredScenarios,
    findUncovered,
    buildUuidLineIndex,
    readStepStateFiles,
    stepFolders,
    stepNumberOf,
    type CoveredScenario,
} from "./coverage_scenarios.ts";
import {
    firstLineDifference,
    firstDifferingFile,
    selectBestEngineStep,
} from "./coverage_compare.ts";

// Mismatch details for one step folder the engine could not reproduce.
export type StepMismatch = { stepNum: number; jsonlLine: string; diff: string; provenance: string };

// Whether a provenance entry's target is the repo-relative differing file (matched on a path boundary).
function targetMatchesFile(target: Path, differingFile: string): boolean {
    const path = target.toString();
    return path === differingFile || path.endsWith(`/${differingFile}`);
}

// One provenance entry as a line: "<stage>: <detail> (changeId …)".
function formatProvenanceEntry(entry: ProvenanceEntry): string {
    const changeId = entry.changeId ? ` (changeId ${entry.changeId})` : "";
    return `${entry.stage}: ${entry.detail}${changeId}`;
}

// Provenance entries touching the differing file at or before this step.
export function renderStepProvenance(
    entries: ProvenanceEntry[],
    differingFile: string,
    stepTime: Date,
): string {
    const matching = entries.filter(
        (entry) =>
            targetMatchesFile(entry.target, differingFile) &&
            (entry.when === undefined || entry.when.getTime() <= stepTime.getTime()),
    );
    const formattedEntries = matching.map(formatProvenanceEntry);
    return formattedEntries.join("\n");
}

// A scenario's per-step result: how many captured folders some engine step reproduced, and the misses.
export type ScenarioResult = {
    scenario: CoveredScenario;
    passed: number;
    userEdits: number;
    total: number;
    mismatches: StepMismatch[];
};


// Resolve the best step's changeId to a JSONL line number, or a sentinel for seeded revisions.
function jsonlLineFor(change: StepChange | undefined, uuidLineIndex: Map<string, number>): string {
    for (const changeId of change?.changeIds ?? []) {
        const line = uuidLineIndex.get(changeId.toString());
        if (line !== undefined) {
            return `line ${line}`;
        }
    }
    return "(seeded — no JSONL line)";
}

// A one-line description of where the best engine step diverges from the ground-truth file.
function describeDiff(file: string, expected: string, actual: string): string {
    const lineDiff = firstLineDifference(expected, actual);
    if (lineDiff === undefined) {
        return `${file} (file absent or only-trailing difference)`;
    }
    return `${file} @line ${lineDiff.lineNo}: expected ${JSON.stringify(lineDiff.expected)} got ${JSON.stringify(lineDiff.actual)}`;
}

// Build a mismatch record for one failing step folder using the best-matching engine step.
function buildStepMismatch(
    stepNum: number,
    groundTruth: ReadonlyMap<string, string>,
    steps: RepoSnapshot[],
    stepChanges: StepChange[],
    uuidLineIndex: Map<string, number>,
    provenance: ProvenanceEntry[],
): StepMismatch {
    if (steps.length === 0) {
        const file = [...groundTruth.keys()][0] ?? "(folder empty)";
        return {
            stepNum,
            jsonlLine: "(no engine steps)",
            diff: `${file}: engine produced 0 steps (scenario may need a baseline session excluded)`,
            provenance: "",
        };
    }
    const best = selectBestEngineStep(steps, groundTruth);
    const file = firstDifferingFile(steps[best]!, groundTruth) ?? [...groundTruth.keys()][0]!;
    const expected = stripTrailingNewline(groundTruth.get(file)!);
    const actual = snapshotFileText(steps[best]!, file) ?? "";
    const diff = describeDiff(file, expected, actual);
    const stepProvenance = renderStepProvenance(provenance, file, stepChanges[best]!.when);
    return { stepNum, jsonlLine: jsonlLineFor(stepChanges[best], uuidLineIndex), diff, provenance: stepProvenance };
}

// Reconstruct a scenario's steps, comparing each captured folder against engine output.
export function checkScenario(scenario: CoveredScenario): ScenarioResult {
    console.log(`\n=== scenario ${scenario.scenarioId} (${scenario.dirName}) ===`);
    const loaded = scenario.jsonlPaths.flatMap((path) => loadTranscript(path.toString()).records);
    // Spec S7c: a multi-source capture routes through the viewer's merge stages + per-source reader.
    const records = scenario.sources === undefined
        ? loaded
        : mergeMultiSourceRecords(groupRecordsBySession(loaded), scenario.sources);
    console.log(`   Loaded ${records.length} transcript records from ${scenario.jsonlPaths.length} JSONL files`);
    const reader = buildSidecarReader(records, scenario.sources);
    const uuidLineIndex = buildUuidLineIndex(scenario.jsonlPaths);
    enableProvenance();
    const steps = reconstructStepStates(records, reader);
    const provenance = drainProvenance();
    disableProvenance();
    const stepChanges = reconstructStepChanges(records, reader);
    const mismatches: StepMismatch[] = [];
    let passed = 0;
    let userEdits = 0;
    const folders = stepFolders(scenario.stepStatesDir);
    for (let i = 0; i < folders.length; i += 1) {
        const groundTruth = readStepStateFiles(join(scenario.stepStatesDir, folders[i]!));
        if (someStepReproduces(steps, groundTruth)) {
            passed += 1;
            continue;
        }
        // ponytail: look-ahead — if a later folder matches an engine step, this folder is a user-edit the transcript coalesced (scenario runner did 2+ Edit: steps between prompts)
        const laterFolders = folders.slice(i + 1);
        const laterMatches = laterFolders.some((later) => {
            const laterGroundTruth = readStepStateFiles(join(scenario.stepStatesDir, later));
            return someStepReproduces(steps, laterGroundTruth);
        });
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

// Wraps checkScenario so a thrown error becomes an ERROR result instead of aborting the sweep.
export function checkScenarioResilient(scenario: CoveredScenario): ScenarioResult {
    try {
        return checkScenario(scenario);
    } catch (error) {
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

// Print one scenario's row in the coverage matrix, plus a line per mismatch.
function printResult(result: ScenarioResult): void {
    const status = result.mismatches.length === 0 ? "OK  " : "FAIL";
    const userEditNote = result.userEdits > 0 ? `  (${result.userEdits} user-edit)` : "";
    console.log(`${status} ${result.scenario.scenarioId.padEnd(5)} ${result.passed}/${result.total}  ${result.scenario.dirName}${userEditNote}`);
    for (const mismatch of result.mismatches) {
        console.log(`       step ${mismatch.stepNum}  ${mismatch.jsonlLine}  ${mismatch.diff}`);
        const provenanceLines = mismatch.provenance.split("\n");
        const nonEmptyProvenanceLines = provenanceLines.filter((entry) => entry.length > 0);
        for (const line of nonEmptyProvenanceLines) {
            console.log(`         ↳ ${line}`);
        }
    }
}

// Sweep covered scenarios, print coverage matrix, exit 1 on failure, exit 2 on no match.
function main(): void {
    const executedRoot = new URL("../scenarios/executed/", import.meta.url);
    const onlyFailing = process.argv.includes("--onlyFailing");
    const cliArgs = process.argv.slice(2);
    const filter = cliArgs.find((arg) => !arg.startsWith("--"));
    const allCovered = listCoveredScenarios();
    const covered = allCovered.filter(
        (scenario) => filter === undefined || scenario.scenarioId === filter || scenario.dirName === filter,
    );
    if (covered.length === 0 && filter !== undefined) {
        console.error(`no covered scenario matches "${filter}"`);
        process.exit(2);
    }
    const results = covered.map(checkScenarioResilient);
    for (const result of results) {
        if (onlyFailing && result.mismatches.length === 0) continue;
        printResult(result);
    }
    if (filter === undefined) {
        const uncovered = findUncovered(executedRoot, covered);
        console.log(`\nUncovered (no .step_states): ${uncovered.length === 0 ? "none" : uncovered.join(", ")}`);
    }
    const failed = results.filter((result) => result.mismatches.length > 0);
    console.log(`${results.length - failed.length}/${results.length} scenarios fully reproduced.`);
    process.exit(failed.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}


