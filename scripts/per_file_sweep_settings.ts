import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { applyCliPathOverrides, parseArgs } from "../src/reconstruction_cli_args.ts";
import { getPathOverrides } from "../src/reconstruction_overrides.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { selectCandidatesByStatus } from "../src/per_file_sweep_report.ts";
import { Path } from "../src/structures/domain.ts";
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

export interface SweepSettings {
  repo: Path;
  baseCommit: string;
  projects: Path;
  fileHistory: Path;
  status: string;
  outPath: Path;
  tablePath: Path;
  limit: number;
}

export function readSweepSettings(argv: string[]): SweepSettings {
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
export function listCandidates(settings: SweepSettings): Path[] {
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
export function loadSweepInputs(settings: SweepSettings): { records: TranscriptRecord[]; reader: ReturnType<typeof buildSidecarReader> } {
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
