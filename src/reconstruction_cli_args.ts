// Split out of reconstruction_cli.ts to stay under the 250-line cap; render/dispatch stays there.

import { basename, dirname } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import {
    hydrateProjectPaths,
    hydrateProjectSources,
    readProjectPathsConfig,
    setPathOverrides,
    type PathOverrides,
    type SourceEntry,
    type WireProjectPaths,
} from "./reconstruction_overrides.ts";
import { setPreBaselineReconstructionAllowed } from "./reconstruction_base_commit.ts";

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
    // When false the base-commit beacon supersedes everything at-or-before it, so a re-seeded
    // iteration reconstructs only forward from its seed.
    preBaseline: boolean;
    // Bounds the run at the end of the turn containing this file's nth revision (1-based).
    untilRevision: Path | undefined;
    untilNth: number;
};

// Removes both flag and value so the positional transcript-path scan never mistakes a value for it.
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

// Both DAGs are the bare default: they turn on only when no selector or content-view flag was given.
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
    if (nthFlag.value !== undefined && untilRevisionFlag.value === undefined) {
        throw new Error(USAGE);
    }
    const rest = nthFlag.rest;
    const jsonlPaths = rest.filter((arg) => !arg.startsWith("--"));
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
    const graphs = resolveGraphFlags(rest, branchFlag.value, surviving, listBranches, verbose, diff);
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
    if (!Number.isInteger(ordinal)) {
        throw new Error(USAGE);
    }
    if (ordinal < 1) {
        throw new Error(USAGE);
    }
    return ordinal;
}

// The transcript's config entry is the base; direct CLI flags win per-field. fileHistoryRoot has no
// config field — folder-level discovery is the viewer's job — so it arrives only via its flag.
export function applyCliPathOverrides(options: CliOptions): void {
    const projectDir = dirname(options.jsonlPath);
    const entry = readProjectPathsConfig(new Path(dirname(projectDir)))[basename(projectDir)];
    const merged: PathOverrides = entry !== undefined ? hydrateProjectPaths(entry) : {};
    const sources = resolveCliSources(options, entry, projectDir);
    if (sources !== undefined) {
        merged.sources = sources;
    }
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
    // Set unconditionally: the gate is module state shared with the viewer, so an in-process CLI
    // run must never inherit a previous run's answer.
    setPreBaselineReconstructionAllowed(options.preBaseline);
    setPathOverrides(merged);
}

// Multi-root runs get one bare source per distinct projects root so per-source sibling file-history
// resolution works with zero config; single-root runs stay sources-less.
function resolveCliSources(
    options: CliOptions,
    entry: WireProjectPaths | undefined,
    projectDir: string,
): SourceEntry[] | undefined {
    if (entry?.sources !== undefined) {
        return hydrateProjectSources(new Path(dirname(projectDir)), entry);
    }
    const distinctRoots: string[] = [];
    for (const jsonlPath of options.jsonlPaths) {
        const projectsRoot = dirname(dirname(jsonlPath));
        if (!distinctRoots.includes(projectsRoot)) {
            distinctRoots.push(projectsRoot);
        }
    }
    if (distinctRoots.length <= 1) {
        return undefined;
    }
    return distinctRoots.map((projectsRoot) => ({ projectsDir: new Path(projectsRoot) }));
}

// Non-integer values are a usage error, caught here so the positional path scan never sees them.
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
