// Checks how many of a recorded scenario's step texts the inverse repos recover, walking back from the last step.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { findFirstRecordCwd } from "../src/reconstruction_base_commit_evidence.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { isDirectory } from "../scripts/coverage_scenarios.ts";
import { listStepFolders, readStepStateFiles } from "../scripts/step_state_files.ts";
import { buildInverseReposForFiles, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";

export type MissedStepText = { relativePath: string; stepName: string; isFileAbsentInStep: boolean };

export type ScenarioCheckResult = { scenarioName: string; fileCount: number; stepTextCount: number; foundStepTextCount: number; missedStepTexts: MissedStepText[]; commitCount: number; unknownStateCount: number };

export type ScenarioCheckSettings = { scenariosFolder: Path; fileHistoryFolder: Path; onlyScenarioNames: string[] };

const USAGE = "usage: node engineV3_inverse_repos_scenario_check.ts --scenarios <executed folder> --file-history <folder> [--only <scenario name>]...";

// The inverse repo orders its commits by position, so one fixed instant is enough; git rejects an author date before 1973 or after 2099.
const FIXED_DISK_NOW_INSTANT = new Date(Date.UTC(2099, 0, 1));

export function checkScenarioAgainstStepStates(scenarioFolder: Path, fileHistoryFolder: Path, workFolder: Path): ScenarioCheckResult {
    const scenarioName = basename(scenarioFolder.toString());
    const stepStatesFolder = join(scenarioFolder.toString(), ".step_states");
    const stepNames = listStepFolders(stepStatesFolder);
    if (stepNames.length === 0) {
        throw new Error(`checkScenarioAgainstStepStates: scenario ${scenarioName} has no step folders in ${stepStatesFolder}`);
    }
    const filesByStepName = new Map<string, Map<string, string>>();
    const relativePathSet = new Set<string>();
    for (const stepName of stepNames) {
        const stepFiles = readStepStateFiles(join(stepStatesFolder, stepName));
        filesByStepName.set(stepName, stepFiles);
        for (const relativePath of stepFiles.keys()) {
            relativePathSet.add(relativePath);
        }
    }
    const relativePaths = [...relativePathSet].sort();

    const projectFolder = join(workFolder.toString(), "project");
    mkdirSync(projectFolder);
    const lastStepFiles = filesByStepName.get(stepNames[stepNames.length - 1]!)!;
    for (const [relativePath, text] of lastStepFiles) {
        mkdirSync(dirname(join(projectFolder, relativePath)), { recursive: true });
        writeFileSync(join(projectFolder, relativePath), text);
    }
    const scenarioGitFolder = join(scenarioFolder.toString(), ".git");
    if (isDirectory(scenarioGitFolder)) {
        cpSync(scenarioGitFolder, join(projectFolder, ".git"), { recursive: true });
    }

    const transcriptFile = listTranscriptFiles([scenarioFolder.toString()])[0];
    if (transcriptFile === undefined) {
        throw new Error(`checkScenarioAgainstStepStates: scenario ${scenarioName} has no transcript`);
    }
    const recordedRoot = findFirstRecordCwd(loadTranscript(transcriptFile.toString()).records);
    if (recordedRoot === undefined) {
        throw new Error(`checkScenarioAgainstStepStates: the transcript ${transcriptFile.toString()} records no cwd`);
    }
    const projectFiles: ProjectFile[] = relativePaths.map((relativePath) => ({ file: new Path(join(projectFolder, relativePath)), transcriptFile: new Path(join(recordedRoot.toString(), relativePath)) }));
    const results = buildInverseReposForFiles(new Path(projectFolder), projectFiles, [scenarioFolder], [fileHistoryFolder], new Path(join(workFolder.toString(), "store")), FIXED_DISK_NOW_INSTANT, () => {});

    const missedStepTexts: MissedStepText[] = [];
    let foundStepTextCount = 0;
    for (const [fileIndex, relativePath] of relativePaths.entries()) {
        const commits = listInverseCommits(results[fileIndex]!.repoFolder, basename(relativePath));
        const commitTexts = new Set<string>();
        let hasAbsentCommit = false;
        for (const commit of commits) {
            if (commit.isFileAbsent) {
                hasAbsentCommit = true;
            } else {
                commitTexts.add(commit.text!);
            }
        }
        for (const stepName of stepNames) {
            const expectedText = filesByStepName.get(stepName)!.get(relativePath);
            const isFileAbsentInStep = expectedText === undefined;
            const isFound = isFileAbsentInStep ? hasAbsentCommit : commitTexts.has(expectedText);
            if (isFound) {
                foundStepTextCount++;
            } else {
                missedStepTexts.push({ relativePath, stepName, isFileAbsentInStep });
            }
        }
    }
    const commitCount = results.reduce((sum, result) => sum + result.commitCount, 0);
    const unknownStateCount = results.reduce((sum, result) => sum + result.unknownStateCount, 0);
    return { scenarioName, fileCount: relativePaths.length, stepTextCount: relativePaths.length * stepNames.length, foundStepTextCount, missedStepTexts, commitCount, unknownStateCount };
}

function readRequiredFolderFlag(argumentList: string[], flag: string): { folder: Path; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    return { folder: new Path(value), rest };
}

export function readScenarioCheckSettingsFromArguments(argumentList: string[]): ScenarioCheckSettings {
    const scenariosFlag = readRequiredFolderFlag(argumentList, "--scenarios");
    const fileHistoryFlag = readRequiredFolderFlag(scenariosFlag.rest, "--file-history");
    const onlyScenarioNames: string[] = [];
    let rest = fileHistoryFlag.rest;
    for (;;) {
        const onlyFlag = extractValueFlag(rest, "--only");
        if (onlyFlag.value === undefined) {
            break;
        }
        onlyScenarioNames.push(onlyFlag.value);
        rest = onlyFlag.rest;
    }
    return { scenariosFolder: scenariosFlag.folder, fileHistoryFolder: fileHistoryFlag.folder, onlyScenarioNames };
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
    const settings = readScenarioCheckSettingsFromArguments(process.argv.slice(2));
    const startMilliseconds = Date.now();
    const candidateNames = settings.onlyScenarioNames.length > 0 ? settings.onlyScenarioNames : readdirSync(settings.scenariosFolder.toString()).sort();
    const scenarioNames: string[] = [];
    const namesWithoutStepStates: string[] = [];
    for (const name of candidateNames) {
        if (isDirectory(join(settings.scenariosFolder.toString(), name, ".step_states"))) {
            scenarioNames.push(name);
        } else {
            namesWithoutStepStates.push(name);
        }
    }
    const missLines: string[] = [];
    let foundTotal = 0;
    let allTotal = 0;
    for (const [index, name] of scenarioNames.entries()) {
        const workFolder = mkdtempSync(join(tmpdir(), "scenario-check-"));
        const result = checkScenarioAgainstStepStates(new Path(join(settings.scenariosFolder.toString(), name)), settings.fileHistoryFolder, new Path(workFolder));
        rmSync(workFolder, { recursive: true, force: true });
        console.log(`${index + 1}/${scenarioNames.length}  ${name}  files ${result.fileCount}  step texts ${result.foundStepTextCount}/${result.stepTextCount}  commits ${result.commitCount}  unknown ${result.unknownStateCount}`);
        foundTotal += result.foundStepTextCount;
        allTotal += result.stepTextCount;
        for (const miss of result.missedStepTexts) {
            missLines.push(`MISS  ${name}  ${miss.stepName}  ${miss.relativePath}  (absent in step: ${miss.isFileAbsentInStep})`);
        }
    }
    for (const missLine of missLines) {
        console.log(missLine);
    }
    const seconds = ((Date.now() - startMilliseconds) / 1000).toFixed(1);
    console.log(`done: ${scenarioNames.length} scenarios, ${foundTotal}/${allTotal} step texts found, ${seconds}s`);
    for (const name of namesWithoutStepStates) {
        console.log(`no step states: ${name}`);
    }
}
