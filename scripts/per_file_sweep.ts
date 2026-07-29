// Per-file sweep runner (S11): reconstructs each candidate file individually.
//
// Shares one records array so memoized work pays its cost once.
//
// Usage: npx tsx scripts/per_file_sweep.ts [--repo DIR] [--out JSONL] [--table MD]

import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { applyCliPathOverrides, parseArgs } from "../src/reconstruction_cli_args.ts";
import { getPathOverrides } from "../src/reconstruction_overrides.ts";
import { findFirstRecordCwd } from "../src/reconstruction_base_commit.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { reconstructSurvivingFileHistory } from "../src/reconstruction_target.ts";
import { linesTextOf } from "../src/reconstruction_revisions.ts";
import { formatSweepTable, type SweepRow } from "../src/per_file_sweep_report.ts";
import { selectCandidatesByStatus } from "../src/per_file_sweep_report.ts";
import { Path } from "../src/structures/domain.ts";
import type { FileRevision } from "../src/reconstruction_engine.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// Defaults resolve to RevEng root so output lands beside the S8 doc.
const REVENG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOT_BASELINE_COMMIT = "793e65241902f276caf5f5c28d539269e7d36d11";

// One flag's value out of argv, or the default. Long-form `--flag value` only, matching the CLI.
function readFlag(argv: string[], flag: string, fallback: string): string {
    const at = argv.indexOf(flag);
    if (at === -1) {
        return fallback;
    }
    return argv[at + 1] ?? fallback;
}

interface SweepSettings {
    repo: Path;
    baseCommit: string;
    projects: Path;
    fileHistory: Path;
    status: string;
    outPath: Path;
    tablePath: Path;
    limit: number;
}

function readSweepSettings(argv: string[]): SweepSettings {
    const recovery = join(homedir(), "Programming", "jot-recovery", "claude-data");
    return {
        repo: new Path(readFlag(argv, "--repo", join(homedir(), "Programming", "jot"))),
        baseCommit: readFlag(argv, "--base-commit", JOT_BASELINE_COMMIT),
        projects: new Path(readFlag(
            argv,
            "--projects",
            join(recovery, "projects", "-Users-matkatmusicllc-Programming-jot"),
        )),
        fileHistory: new Path(readFlag(argv, "--fhsLoc", join(recovery, "file-history"))),
        status: readFlag(argv, "--status", "M"),
        outPath: new Path(readFlag(argv, "--out", join(REVENG_ROOT, "plans", "166-per-file-sweep-results.jsonl"))),
        tablePath: new Path(readFlag(argv, "--table", join(REVENG_ROOT, "plans", "166-per-file-sweep-table.md"))),
        limit: Number(readFlag(argv, "--limit", "0")),
    };
}

// The candidates of the requested status, from the working tree's diff against the baseline.
function listCandidates(settings: SweepSettings): Path[] {
    const nameStatus = execSync(`git diff --name-status ${settings.baseCommit}`, {
        cwd: settings.repo.toString(),
        maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const candidates = selectCandidatesByStatus(nameStatus, settings.status);
    if (settings.limit < 1) {
        return candidates;
    }
    return candidates.slice(0, settings.limit);
}

// Top-level .jsonl transcripts in name order; subdirectories hold sidecars, not transcripts.
function listTranscriptPaths(projects: Path): Path[] {
    return readdirSync(projects.toString())
        .filter((name) => name.endsWith(".jsonl"))
        .sort()
        .map((name) => new Path(join(projects.toString(), name)));
}

// Loads all transcripts once; shared records array lets memoization pay cost once.
function loadSweepInputs(settings: SweepSettings): { records: TranscriptRecord[]; reader: ReturnType<typeof buildSidecarReader> } {
    const transcripts = listTranscriptPaths(settings.projects).map((path) => path.toString());
    const options = parseArgs([
        ...transcripts,
        "--repo", settings.repo.toString(),
        "--base-commit", settings.baseCommit,
        "--fhsLoc", settings.fileHistory.toString(),
        "--branch", "surviving",
    ]);
    applyCliPathOverrides(options);
    console.error(`loading ${transcripts.length} transcripts from ${settings.projects.toString()}`);
    const records = options.jsonlPaths.map((jsonlPath) => loadTranscript(jsonlPath).records).flat();
    console.error(`loaded ${records.length} records; building sidecar reader`);
    return { records, reader: buildSidecarReader(records, getPathOverrides().sources) };
}

// A revision's bytes in the form that blob-matched in task 182: lines joined, trailing newline.
function renderRevisionText(revision: FileRevision): string {
    return linesTextOf(revision).join("\n") + "\n";
}

function hashBlobOfText(text: string): string {
    return execFileSync("git", ["hash-object", "--stdin"], { input: text }).toString().trim();
}

// The baseline blob sha for the candidate, or undefined when the baseline holds no such path.
function readBaselineBlobSha(settings: SweepSettings, relativePath: Path): string | undefined {
    try {
        return execSync(`git rev-parse ${settings.baseCommit}:${JSON.stringify(relativePath.toString())}`, {
            cwd: settings.repo.toString(),
        }).toString().trim();
    } catch {
        return undefined;
    }
}

// Returns working-tree text, or undefined if the file was deleted (D-phase normal case).
function readWorkingTreeText(settings: SweepSettings, relativePath: Path): string | undefined {
    const onDisk = join(settings.repo.toString(), relativePath.toString());
    if (!existsSync(onDisk)) {
        return undefined;
    }
    return readFileSync(onDisk, "utf8");
}

// Builds one SweepRow; catches throws so one bad candidate never kills the sweep.
function buildSweepRow(
    settings: SweepSettings,
    records: TranscriptRecord[],
    reader: ReturnType<typeof buildSidecarReader>,
    recordedRoot: Path,
    relativePath: Path,
): SweepRow {
    const target = new Path(join(recordedRoot.toString(), relativePath.toString()));
    const startedAt = Date.now();
    let revisions: FileRevision[];
    try {
        revisions = reconstructSurvivingFileHistory(records, target, reader)?.revisions ?? [];
    } catch (error) {
        return {
            file: relativePath,
            revisions: 0,
            baselineBlobMatched: false,
            diskMatched: false,
            unrecoverable: 0,
            seconds: Math.round((Date.now() - startedAt) / 1000),
            note: `threw: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    const last = revisions[revisions.length - 1];
    const baselineSha = readBaselineBlobSha(settings, relativePath);
    const diskText = readWorkingTreeText(settings, relativePath);
    return {
        file: relativePath,
        // Baseline blob may appear mid-ladder, not at revision 0, due to git-seed timing.
        baselineBlobMatched: baselineSha !== undefined
            && revisions.some((revision) => hashBlobOfText(renderRevisionText(revision)) === baselineSha),
        revisions: revisions.length,
        diskMatched: last !== undefined && diskText !== undefined && renderRevisionText(last) === diskText,
        unrecoverable: revisions.filter((revision) => revision.unrecoverable !== undefined).length,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        note: diskText === undefined ? "absent from the working tree" : "",
    };
}

// The candidates already logged in a previous (possibly killed) run.
function readCompletedRows(outPath: Path): SweepRow[] {
    if (!existsSync(outPath.toString())) {
        return [];
    }
    return readFileSync(outPath.toString(), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
            const wire = JSON.parse(line) as SweepRow & { file: string };
            return { ...wire, file: new Path(wire.file) };
        });
}

// The whole sweep for one argv (exported so tests drive it in-process, argv and all).
export function runSweep(argv: string[]): void {
    const settings = readSweepSettings(argv);
    const candidates = listCandidates(settings);
    const rows = readCompletedRows(settings.outPath);
    const done = new Set(rows.map((row) => row.file.toString()));
    console.error(`${candidates.length} ${settings.status} candidates, ${done.size} already logged`);
    const { records, reader } = loadSweepInputs(settings);
    const recordedRoot = findFirstRecordCwd(records);
    if (recordedRoot === undefined) {
        throw new Error("no cwd recorded in any transcript — cannot resolve candidates to absolute paths");
    }
    for (const [index, relativePath] of candidates.entries()) {
        if (done.has(relativePath.toString())) {
            continue;
        }
        console.error(`[${index + 1}/${candidates.length}] ${relativePath.toString()}`);
        const row = buildSweepRow(settings, records, reader, recordedRoot, relativePath);
        rows.push(row);
        appendFileSync(settings.outPath.toString(), `${JSON.stringify(row)}\n`);
        writeFileSync(settings.tablePath.toString(), `${formatSweepTable(rows)}\n`);
    }
    console.error(`wrote ${rows.length} rows to ${settings.tablePath.toString()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runSweep(process.argv.slice(2));
}

