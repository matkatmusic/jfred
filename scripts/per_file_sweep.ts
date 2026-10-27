// Per-file sweep runner (S11): reconstructs each candidate file individually. Usage: npx tsx scripts/per_file_sweep.ts [--repo DIR] [--out JSONL] [--table MD]

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findFirstRecordCwd } from "../src/reconstruction_base_commit.ts";
import { formatSweepTable, type SweepRow } from "../src/per_file_sweep_report.ts";
import { Path } from "../src/structures/domain.ts";
import { buildSweepRow } from "./per_file_sweep_row.ts";
import { listCandidates, loadSweepInputs, readSweepSettings } from "./per_file_sweep_settings.ts";

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
