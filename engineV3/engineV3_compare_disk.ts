// Mac side: compares the replayed state folder with the disk for touched paths. Only reads.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { ChangeKind } from "./engineV3_replay_snapshot.ts";
import type { EventSnapshot } from "./engineV3_replay_snapshot_write.ts";

const USAGE = "usage: tsx engineV3_compare_disk.ts --state <folder> --disk <folder> --touched <file> --events <snapshot events folder> --container-state <state folder path inside the container>";

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

// The event files say which event made the last change to each path; the container state path turns their absolute paths into state-relative ones.
export type SkipCheck = { eventsFolder: Path; containerState: Path };

const NO_EVENT_SOURCE = "no event";
// Event file names: NNNNNN_<jsonl name>_<line>.json for a JSONL line; 000000_start.json, _commit_, _outside-git_, _plate_ and _idle-state_ for the rest.
const JSONL_EVENT_FILE_NAME = /^\d+_(?!start\.json|commit_|outside-git_|plate_|idle-state_).+_\d+\.json$/;

function listLastChangeSources(skipCheck: SkipCheck): Map<string, string> {
  const lastChangeSources = new Map<string, string>();
  const directoryPaths = new Set<string>();
  const eventsFolder = skipCheck.eventsFolder.toString();
  for (const eventFileName of readdirSync(eventsFolder).sort()) {
    const event: EventSnapshot = JSON.parse(readFileSync(join(eventsFolder, eventFileName), "utf8"));
    for (const change of event.changes) {
      const storedPath = relative(skipCheck.containerState.toString(), change.path);
      if (change.directory === true) {
        directoryPaths.add(storedPath);
        lastChangeSources.delete(storedPath);
        continue;
      }
      // a delete change carries no directory flag, so a deleted directory is known from its earlier change
      if (change.change === ChangeKind.Deleted) {
        if (directoryPaths.delete(storedPath)) {
          continue;
        }
      }
      directoryPaths.delete(storedPath);
      lastChangeSources.set(storedPath, eventFileName);
    }
  }
  return lastChangeSources;
}

// A short run lists only its own touched paths, so every file path the store holds inside the state folder is checked too.
function listPathsToCheck(touchedFile: Path, lastChangeSources: Map<string, string> | undefined): string[] {
  const pathsToCheck = new Set(readTouchedPaths(touchedFile));
  if (lastChangeSources !== undefined) {
    for (const storedPath of lastChangeSources.keys()) {
      if (storedPath.startsWith("../") === false) {
        pathsToCheck.add(storedPath);
      }
    }
  }
  return [...pathsToCheck].sort();
}

// A file inside a submodule or nested repo is asked about in that repo: the outer repo refuses paths inside it.
function findRepoFolderOf(state: Path, touchedPath: string): string | undefined {
  let folder = dirname(touchedPath);
  for (;;) {
    if (existsSync(join(state.toString(), folder, ".git"))) {
      return folder;
    }
    if (folder === ".") {
      return undefined;
    }
    folder = dirname(folder);
  }
}

function isGitIgnored(state: Path, touchedPath: string): boolean {
  if (touchedPath.startsWith("../")) {
    return false;
  }
  const repoFolder = findRepoFolderOf(state, touchedPath);
  if (repoFolder === undefined) {
    return false;
  }
  const result = spawnSync("git", ["check-ignore", "-q", "--", relative(repoFolder, touchedPath)], { cwd: join(state.toString(), repoFolder) });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(`git check-ignore ${touchedPath} failed in ${state.toString()}: ${result.error?.message ?? result.stderr.toString()}`);
}

export function compareStateToDisk(state: Path, disk: Path, touchedFile: Path, skipCheck?: SkipCheck): string[] {
  const lines: string[] = [];
  let missingCount = 0;
  let extraCount = 0;
  let differentCount = 0;
  let sameCount = 0;
  let skippedCount = 0;
  const lastChangeSources = skipCheck === undefined ? undefined : listLastChangeSources(skipCheck);
  for (const touchedPath of listPathsToCheck(touchedFile, lastChangeSources)) {
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
    if (lastChangeSources !== undefined) {
      const lastChangeSource = lastChangeSources.get(touchedPath) ?? NO_EVENT_SOURCE;
      if (JSONL_EVENT_FILE_NAME.test(lastChangeSource) === false) {
        if (isGitIgnored(state, touchedPath)) {
          lines.push(`skipped (gitignored, last change not from a JSONL line: ${lastChangeSource}): ${touchedPath}`);
          skippedCount++;
          continue;
        }
      }
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
  const skippedText = skipCheck === undefined ? "" : `, ${skippedCount} skipped`;
  lines.push(`check vs disk ${disk.toString()}: ${missingCount} missing, ${extraCount} extra, ${differentCount} different, ${sameCount} same${skippedText}`);
  return lines;
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
  const argumentList = process.argv.slice(2);
  const state = new Path(readRequiredFlag(argumentList, "--state"));
  const disk = chooseDiskFolder(new Path(readRequiredFlag(argumentList, "--disk")));
  const touchedFile = new Path(readRequiredFlag(argumentList, "--touched"));
  const skipCheck = { eventsFolder: new Path(readRequiredFlag(argumentList, "--events")), containerState: new Path(readRequiredFlag(argumentList, "--container-state")) };
  for (const line of compareStateToDisk(state, disk, touchedFile, skipCheck)) {
    console.log(line);
  }
}
