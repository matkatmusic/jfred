// Split out of reconstruction_cli.ts to stay under the 250-line cap; render/dispatch stays there.

import { Path, Uuid } from "./structures/domain.ts";
import { computeGraphFlags, extractValueFlag } from "./reconstruction_cli_flags.ts";

export const USAGE =
  "usage: reconstruction_cli <transcript.jsonl> [more.jsonl …] [--target|--file <path>] [--count-steps|--step <n>] [--verbose|--diff] [--graphConvo|--graphFile|--surviving|--list-branches|--branch <id>] [--json] [--allRecords] [--progress|--progress-all] [--file-history-loc|--fhsLoc <dir>] [--cwd <dir>] [--repo <dir>] [--base-commit <hash>] [--no-pre-baseline] [--until-revision <path> [--nth <n>]]";

export type CliOptions = {
  jsonlPath: string;
  // Every positional is a transcript; jsonlPath stays the first because config lookup keys on it.
  jsonlPaths: string[];
  target: Path | undefined;
  branch: string | undefined;
  countSteps: boolean;
  stepNumber: number | undefined;
  verbose: boolean;
  diff: boolean;
  surviving: boolean;
  listBranches: boolean;
  graphConvo: boolean;
  graphFile: boolean;
  json: boolean;
  allRecords: boolean;
  // `progress` = stage labels only; `progressAll` adds per-item events and implies `progress`.
  progress: boolean;
  progressAll: boolean;
  fileHistoryRoot: Path | undefined;
  projectCwd: Path | undefined;
  repoDir: Path | undefined;
  baseCommit: Uuid | undefined;
  // When false the base-commit beacon supersedes everything at-or-before it, so reconstruction runs forward from its seed.
  preBaseline: boolean;
  // Bounds the run at the end of the turn containing this file's nth revision (1-based).
  untilRevision: Path | undefined;
  untilNth: number;
};

export function parseArgs(argv: string[]): CliOptions {
  const targetFlag = extractValueFlag(argv, "--target");
  const fileAlias = targetFlag.value === undefined ? extractValueFlag(targetFlag.rest, "--file") : targetFlag;
  const branchFlag = extractValueFlag(fileAlias.rest, "--branch");
  const stepFlag = extractValueFlag(branchFlag.rest, "--step");
  const fileHistoryFlag = extractValueFlag(stepFlag.rest, "--file-history-loc");
  const fhsAlias = fileHistoryFlag.value === undefined ? extractValueFlag(fileHistoryFlag.rest, "--fhsLoc") : fileHistoryFlag;
  const cwdFlag = extractValueFlag(fhsAlias.rest, "--cwd");
  const repoFlag = extractValueFlag(cwdFlag.rest, "--repo");
  const baseCommitFlag = extractValueFlag(repoFlag.rest, "--base-commit");
  const untilRevisionFlag = extractValueFlag(baseCommitFlag.rest, "--until-revision");
  const nthFlag = extractValueFlag(untilRevisionFlag.rest, "--nth");
  const isNthWithoutUntil = nthFlag.value !== undefined && untilRevisionFlag.value === undefined;
  if (isNthWithoutUntil) {
    throw new Error(USAGE);
  }
  const rest = nthFlag.rest;
  const jsonlPaths: string[] = [];
  for (const arg of rest) {
    const isFlag = arg.startsWith("--");
    if (!isFlag) {
      jsonlPaths.push(arg);
    }
  }
  const jsonlPath = jsonlPaths[0];
  if (!jsonlPath) {
    throw new Error(USAGE);
  }
  const stepNumber = parseStepNumber(stepFlag.value);
  const countSteps = rest.includes("--count-steps");
  const surviving = rest.includes("--surviving");
  const listBranches = rest.includes("--list-branches");
  const verbose = rest.includes("--verbose");
  const diff = rest.includes("--diff");
  const allRecords = rest.includes("--allRecords");
  const json = rest.includes("--json") || allRecords;
  const preBaseline = !rest.includes("--no-pre-baseline");
  const progressAll = rest.includes("--progress-all");
  const progress = rest.includes("--progress") || progressAll;
  const graphs = computeGraphFlags(rest, branchFlag.value, surviving, listBranches, verbose, diff);
  return {
    jsonlPath,
    jsonlPaths,
    target: fileAlias.value !== undefined ? new Path(fileAlias.value) : undefined,
    branch: branchFlag.value,
    countSteps,
    stepNumber,
    verbose,
    diff,
    surviving,
    listBranches,
    graphConvo: graphs.convo,
    graphFile: graphs.file,
    json,
    allRecords,
    progress,
    progressAll,
    fileHistoryRoot: fhsAlias.value !== undefined ? new Path(fhsAlias.value) : undefined,
    projectCwd: cwdFlag.value !== undefined ? new Path(cwdFlag.value) : undefined,
    repoDir: repoFlag.value !== undefined ? new Path(repoFlag.value) : undefined,
    baseCommit: baseCommitFlag.value !== undefined ? new Uuid(baseCommitFlag.value) : undefined,
    preBaseline,
    untilRevision: untilRevisionFlag.value !== undefined ? new Path(untilRevisionFlag.value) : undefined,
    untilNth: parseOrdinal(nthFlag.value),
  };
}

// Absent means the first revision; non-integer or < 1 is a usage error, mirroring parseStepNumber.
function parseOrdinal(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }
  const ordinal = Number(value);
  const isWholeNumber = Number.isInteger(ordinal);
  if (!isWholeNumber) {
    throw new Error(USAGE);
  }
  if (ordinal < 1) {
    throw new Error(USAGE);
  }
  return ordinal;
}

// Non-integer values are a usage error, caught here so the positional path scan never sees them.
function parseStepNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const stepNumber = Number(value);
  const isWholeNumber = Number.isInteger(stepNumber);
  if (!isWholeNumber) {
    throw new Error(USAGE);
  }
  return stepNumber;
}
