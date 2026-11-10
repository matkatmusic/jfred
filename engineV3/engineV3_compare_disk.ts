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

export function chooseDiskFolder(scenarioFolder: Path): Path {
  const stepStatesFolder = join(scenarioFolder.toString(), ".step_states");
  if (existsSync(stepStatesFolder) === false) {
    return scenarioFolder;
  }
  const stepNames = readdirSync(stepStatesFolder).filter((name) => /^step-\d+$/.test(name));
  stepNames.sort((first, second) => Number(first.slice("step-".length)) - Number(second.slice("step-".length)));
  const lastStepName = stepNames[stepNames.length - 1];
  if (lastStepName === undefined) {
    throw new Error(`no step-NNN folder in ${stepStatesFolder}`);
  }
  return new Path(join(stepStatesFolder, lastStepName));
}

export function compareStateToDisk(state: Path, disk: Path, touchedFile: Path): string[] {
  const lines: string[] = [];
  let missingCount = 0;
  let extraCount = 0;
  let differentCount = 0;
  let sameCount = 0;
  for (const touchedPath of readTouchedPaths(touchedFile)) {
    if (touchedPath === ".git") {
      continue;
    }
    if (touchedPath.startsWith(".git/")) {
      continue;
    }
    if (touchedPath === ".idleState") {
      continue;
    }
    if (touchedPath.startsWith(".idleState/")) {
      continue;
    }
    const stateFile = join(state.toString(), touchedPath);
    const diskFile = join(disk.toString(), touchedPath);
    const isInState = existsSync(stateFile);
    const isOnDisk = existsSync(diskFile);
    if (isOnDisk === false) {
      if (isInState) {
        lines.push(`extra in state: ${touchedPath}`);
        extraCount++;
        continue;
      }
      sameCount++;
      continue;
    }
    if (isInState === false) {
      lines.push(`missing from state: ${touchedPath}`);
      missingCount++;
      continue;
    }
    const isSameBytes = readFileSync(stateFile).equals(readFileSync(diskFile));
    if (isSameBytes) {
      sameCount++;
      continue;
    }
    lines.push(`different content: ${touchedPath}`);
    differentCount++;
  }
  lines.push(`check vs disk ${disk.toString()}: ${missingCount} missing, ${extraCount} extra, ${differentCount} different, ${sameCount} same`);
  return lines;
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  const argumentList = process.argv.slice(2);
  const state = new Path(readRequiredFlag(argumentList, "--state"));
  const disk = chooseDiskFolder(new Path(readRequiredFlag(argumentList, "--disk")));
  const touchedFile = new Path(readRequiredFlag(argumentList, "--touched"));
  for (const line of compareStateToDisk(state, disk, touchedFile)) {
    console.log(line);
  }
}
