// Argv parsing for the reconstruction CLI: the CliOptions shape, the flag parser, and the item-46
// path-override application. Split out of reconstruction_cli.ts (250-line cap); the render/dispatch
// half stays there.

import { basename, dirname } from "node:path";
// item 46: import { Path } from "./structures/domain.ts";
import { Path, Uuid } from "./structures/domain.ts";
import {
    hydrateProjectPaths,
    readProjectPathsConfig,
    setPathOverrides,
    type PathOverrides,
} from "./reconstruction_overrides.ts";

// item 46: const USAGE =
// item 46:     "usage: reconstruction_cli <transcript.jsonl> [--target|--file <path>] [--count-steps|--step <n>] [--verbose|--diff] [--graphConvo|--graphFile|--surviving|--list-branches|--branch <id>] [--json] [--allRecords]";
export const USAGE =
    "usage: reconstruction_cli <transcript.jsonl> [--target|--file <path>] [--count-steps|--step <n>] [--verbose|--diff] [--graphConvo|--graphFile|--surviving|--list-branches|--branch <id>] [--json] [--allRecords] [--file-history-loc|--fhsLoc <dir>] [--cwd <dir>] [--repo <dir>] [--base-commit <hash>]";

export type CliOptions = {
    jsonlPath: string;
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
    fileHistoryRoot: Path | undefined;
    projectCwd: Path | undefined;
    repoDir: Path | undefined;
    baseCommit: Uuid | undefined;
};

// Pull a value-taking flag (e.g. `--target <path>`) out of argv: return its value (undefined when
// absent) and argv with both the flag and its value removed, so the positional transcript-path scan
// never mistakes a flag value for the path.
function extractValueFlag(
    argv: string[],
    flag: string,
): { value: string | undefined; rest: string[] } {
    const at = argv.indexOf(flag);
    if (at < 0) {
        return { value: undefined, rest: argv };
    }
    const value = argv[at + 1];
    const rest = argv.filter((_, index) => index !== at && index !== at + 1);
    return { value, rest };
}

// The graph flags: honor explicit --graphConvo/--graphFile; otherwise default BOTH on when the CLI was
// given no other intent (no selector and no content-view modifier) — the new global bare default that
// prints both DAGs for every scenario.
function resolveGraphFlags(
    rest: string[],
    branch: string | undefined,
    surviving: boolean,
    listBranches: boolean,
    verbose: boolean,
    diff: boolean,
): { convo: boolean; file: boolean } {
    const convo = rest.includes("--graphConvo");
    const file = rest.includes("--graphFile");
    const explicit = convo || file;
    if (explicit) {
        return { convo, file };
    }
    const hasOtherIntent = surviving || listBranches || branch !== undefined || verbose || diff;
    if (hasOtherIntent) {
        return { convo: false, file: false };
    }
    return { convo: true, file: true };
}

// Parse argv: a required transcript path, the value-taking flags (--target, --branch), and the
// boolean view flags. Throws the usage message when no transcript path is given.
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
    // item 46: const rest = stepFlag.rest;
    const rest = baseCommitFlag.rest;
    const jsonlPath = rest.find((arg) => !arg.startsWith("--"));
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
    const graphs = resolveGraphFlags(rest, branchFlag.value, surviving, listBranches, verbose, diff);
    return {
        jsonlPath,
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
        fileHistoryRoot: fhsAlias.value !== undefined ? new Path(fhsAlias.value) : undefined,
        projectCwd: cwdFlag.value !== undefined ? new Path(cwdFlag.value) : undefined,
        repoDir: repoFlag.value !== undefined ? new Path(repoFlag.value) : undefined,
        baseCommit: baseCommitFlag.value !== undefined ? new Uuid(baseCommitFlag.value) : undefined,
    };
}

// Apply the path overrides for this run: the transcript's projects-folder config entry
// (projectsDir = dirname(dirname(jsonl)), project = basename(dirname(jsonl))) is the base, and any
// direct CLI flags win per-field (item 46). fileHistoryRoot has no config-file field — folder-level
// file-history discovery is the viewer's job — so it arrives only via its flag.
export function applyCliPathOverrides(options: CliOptions): void {
    const projectDir = dirname(options.jsonlPath);
    const entry = readProjectPathsConfig(new Path(dirname(projectDir)))[basename(projectDir)];
    const merged: PathOverrides = entry !== undefined ? hydrateProjectPaths(entry) : {};
    if (options.fileHistoryRoot !== undefined) {
        merged.fileHistoryRoot = options.fileHistoryRoot;
    }
    if (options.projectCwd !== undefined) {
        merged.projectCwd = options.projectCwd;
    }
    if (options.repoDir !== undefined) {
        merged.repoDir = options.repoDir;
    }
    if (options.baseCommit !== undefined) {
        merged.baseCommit = options.baseCommit;
    }
    setPathOverrides(merged);
}

// Parse the `--step <n>` value into a 1-based step number, or undefined when the flag is absent. A
// present-but-non-integer value is a usage error (caught here so the positional path scan never sees it).
function parseStepNumber(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const stepNumber = Number(value);
    if (!Number.isInteger(stepNumber)) {
        throw new Error(USAGE);
    }
    return stepNumber;
}
