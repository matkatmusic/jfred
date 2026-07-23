// Argv parsing for the reconstruction CLI: the CliOptions shape, the flag parser, and the item-46
// path-override application. Split out of reconstruction_cli.ts (250-line cap); the render/dispatch
// half stays there.

import { basename, dirname } from "node:path";
// item 46: import { Path } from "./structures/domain.ts";
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

// item 46: const USAGE =
// item 46:     "usage: reconstruction_cli <transcript.jsonl> [--target|--file <path>] [--count-steps|--step <n>] [--verbose|--diff] [--graphConvo|--graphFile|--surviving|--list-branches|--branch <id>] [--json] [--allRecords]";
export const USAGE =
    "usage: reconstruction_cli <transcript.jsonl> [more.jsonl …] [--target|--file <path>] [--count-steps|--step <n>] [--verbose|--diff] [--graphConvo|--graphFile|--surviving|--list-branches|--branch <id>] [--json] [--allRecords] [--progress|--progress-all] [--file-history-loc|--fhsLoc <dir>] [--cwd <dir>] [--repo <dir>] [--base-commit <hash>] [--until-revision <path> [--nth <n>]]";

export type CliOptions = {
    jsonlPath: string;
    // Spec S4b: every positional is a transcript; jsonlPath stays the first (the config-lookup
    // and error paths key on it).
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
    // task 191: progress-to-stderr verbosity. `progress` = stage labels only; `progressAll`
    // adds the counted per-item events (and implies `progress`).
    progress: boolean;
    progressAll: boolean;
    fileHistoryRoot: Path | undefined;
    projectCwd: Path | undefined;
    repoDir: Path | undefined;
    baseCommit: Uuid | undefined;
    // task 193: bound the whole reconstruction at the end of the turn containing this file's
    // nth revision (untilNth is 1-based, defaulting to the first revision).
    untilRevision: Path | undefined;
    untilNth: number;
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
    const untilRevisionFlag = extractValueFlag(baseCommitFlag.rest, "--until-revision");
    const nthFlag = extractValueFlag(untilRevisionFlag.rest, "--nth");
    if (nthFlag.value !== undefined && untilRevisionFlag.value === undefined) {
        throw new Error(USAGE);
    }
    // item 46: const rest = stepFlag.rest;
    const rest = nthFlag.rest;
    // item 46 / spec S4b: const jsonlPath = rest.find((arg) => !arg.startsWith("--"));
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
        untilRevision: untilRevisionFlag.value !== undefined ? new Path(untilRevisionFlag.value) : undefined,
        untilNth: parseOrdinal(nthFlag.value),
    };
}

// Parse the `--nth <n>` value into a 1-based revision ordinal; absent means the first revision.
// A present-but-non-integer (or < 1) value is a usage error, mirroring parseStepNumber.
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

// Apply the path overrides for this run: the transcript's projects-folder config entry
// (projectsDir = dirname(dirname(jsonl)), project = basename(dirname(jsonl))) is the base, and any
// direct CLI flags win per-field (item 46). fileHistoryRoot has no config-file field — folder-level
// file-history discovery is the viewer's job — so it arrives only via its flag.
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
    setPathOverrides(merged);
}

// Spec S4b: the run's declared sources — the config entry's `sources` list when the transcript's
// project declares one; else, for positionals spanning more than one DISTINCT projects root, one
// bare {projectsDir} source per root (positional order) so per-source sibling file-history
// resolution works with zero config. Single-root single-transcript runs stay sources-less.
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
