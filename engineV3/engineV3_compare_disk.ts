// Mac side: compares the replayed state folder with the disk for touched paths. Only reads.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";

const USAGE = "usage: tsx engineV3_compare_disk.ts --state <folder> --disk <folder> --touched <file>";

function readRequiredFlag(argumentList: string[], flag: string): string {
  const { value } = extractValueFlag(argumentList, flag);
  if (value === undefined) {
    throw new Error(USAGE);
  }
  return value;
}

function readTouchedPaths(touchedFile: Path): string[] {
  const paths: string[] = [];
  for (const line of readFileSync(touchedFile.toString(), "utf8").split("\n")) {
    if (line !== "") {
      paths.push(line);
    }
  }
  return paths;
}

function findLastStepName(stepStatesFolder: string): string | undefined {
  let lastStepName: string | undefined;
  let lastStepNumber = -1;
  for (const name of readdirSync(stepStatesFolder)) {
    const isStepName = /^step-\d+$/.test(name);
    const stepNumber = Number(name.slice("step-".length));
    const isLastSoFar = isStepName && stepNumber >= lastStepNumber;
    if (isLastSoFar) {
      lastStepName = name;
      lastStepNumber = stepNumber;
    }
  }
  return lastStepName;
}

export function selectDiskFolder(scenarioFolder: Path): Path {
  const stepStatesFolder = join(scenarioFolder.toString(), ".step_states");
  const hasStepStates = existsSync(stepStatesFolder);
  if (hasStepStates === false) {
    return scenarioFolder;
  }
  const lastStepName = findLastStepName(stepStatesFolder);
  if (lastStepName === undefined) {
    throw new Error(`no step-NNN folder in ${stepStatesFolder}`);
  }
  return new Path(join(stepStatesFolder, lastStepName));
}

function isIgnoredTouchedPath(touchedPath: string): boolean {
  if (touchedPath === ".git") {
    return true;
  }
  const isInsideGit = touchedPath.startsWith(".git/");
  if (isInsideGit) {
    return true;
  }
  if (touchedPath === ".idleState") {
    return true;
  }
  const isInsideIdleState = touchedPath.startsWith(".idleState/");
  return isInsideIdleState;
}

enum PathComparison {
  Same = "same",
  Extra = "extra in state",
  Missing = "missing from state",
  Different = "different content",
}

function comparePathToDisk(stateFile: string, diskFile: string): PathComparison {
  const isInState = existsSync(stateFile);
  const isOnDisk = existsSync(diskFile);
  if (isOnDisk === false) {
    return isInState ? PathComparison.Extra : PathComparison.Same;
  }
  if (isInState === false) {
    return PathComparison.Missing;
  }
  const isSameBytes = readFileSync(stateFile).equals(readFileSync(diskFile));
  return isSameBytes ? PathComparison.Same : PathComparison.Different;
}

function filterIgnoredPaths(touchedPaths: string[]): string[] {
  const keptPaths: string[] = [];
  for (const touchedPath of touchedPaths) {
    const isIgnored = isIgnoredTouchedPath(touchedPath);
    if (isIgnored === false) {
      keptPaths.push(touchedPath);
    }
  }
  return keptPaths;
}

export function compareStateToDisk(state: Path, disk: Path, touchedFile: Path): string[] {
  const lines: string[] = [];
  const counts = { [PathComparison.Same]: 0, [PathComparison.Extra]: 0, [PathComparison.Missing]: 0, [PathComparison.Different]: 0 };
  const touchedPaths = filterIgnoredPaths(readTouchedPaths(touchedFile));
  for (const touchedPath of touchedPaths) {
    const comparison = comparePathToDisk(join(state.toString(), touchedPath), join(disk.toString(), touchedPath));
    counts[comparison]++;
    if (comparison !== PathComparison.Same) {
      lines.push(`${comparison}: ${touchedPath}`);
    }
  }
  lines.push(`check vs disk ${disk.toString()}: ${counts[PathComparison.Missing]} missing, ${counts[PathComparison.Extra]} extra, ${counts[PathComparison.Different]} different, ${counts[PathComparison.Same]} same`);
  return lines;
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  const argumentList = process.argv.slice(2);
  const state = new Path(readRequiredFlag(argumentList, "--state"));
  const disk = selectDiskFolder(new Path(readRequiredFlag(argumentList, "--disk")));
  const touchedFile = new Path(readRequiredFlag(argumentList, "--touched"));
  for (const line of compareStateToDisk(state, disk, touchedFile)) {
    console.log(line);
  }
}
