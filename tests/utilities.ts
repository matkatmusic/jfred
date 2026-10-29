import { readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, copyFileSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseRecord } from "../src/parse/parseRecord.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";
// Capture-dependent helpers moved to fixtures.ts (task 64). Commented originals below.
// import { listCoveredScenarios } from "../scripts/coverage_scenarios.ts";

// export function jsonlPathsForScenario(scenarioId: string): Path[] {
//     const scenario = listCoveredScenarios().find((covered) => covered.scenarioId === scenarioId);
//     if (scenario === undefined) {
//         throw new Error(`no covered scenario with id ${scenarioId}`);
//     }
//     return scenario.jsonlPaths;
// }

// Read a text file and return its non-empty lines.
export function readNonEmptyLines(file: string): string[] {
  const fileText = readFileSync(file, "utf8");
  const lines = fileText.split("\n");
  const nonEmptyLines: string[] = [];
  for (const line of lines) {
    const hasContent = line.trim().length > 0;
    if (hasContent)
      nonEmptyLines.push(line);
  }
  return nonEmptyLines;
}

// Parse every non-empty line of a JSONL file into typed records, with no field gate.
export function loadRecords(file: string): TranscriptRecord[] {
  const lines = readNonEmptyLines(file);
  const records: TranscriptRecord[] = [];
  for (const line of lines)
    records.push(parseRecord(line));
  return records;
}

// Moved to fixtures.ts (task 64) — see the note above. Delete once confirmed green.
// export function resolveScenarioDir(roots: readonly string[], dirName: string): string {
//     for (const root of roots) {
//         const dir = join(root, dirName);
//         let entries: string[];
//         try {
//             entries = readdirSync(dir);
//         } catch {
//             continue;
//         }
//         if (entries.some((name) => name.endsWith(".jsonl"))) {
//             return dir;
//         }
//     }
//     throw new Error(`scenario ${dirName}: no directory with .jsonl found under known roots`);
// }

// export function listScenarioJsonlPaths(dir: Path): Path[] {
//     const names = readdirSync(dir.value).filter((name) => name.endsWith(".jsonl")).sort();
//     return names.map((name) => new Path(join(dir.value, name)));
// }

// --- Temp-repo machinery for the range-patch acceptance tests -----------------------------------

// Write a snapshot's absolute-keyed files into `intoDir`, relative to `root`, as renderRangePatch does.
export function writeSnapshotIntoDirectory(files: Record<string, string>, root: string, intoDir: string): void {
  for (const [absolutePath, content] of Object.entries(files)) {
    const destination = join(intoDir, relative(root, absolutePath));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

// Make `dir` a git repository with everything committed, using a pinned identity.
export function git_initRepositoryWithCommit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "--allow-empty", "-m", "before-state"],
    { cwd: dir },
  );
}

// Run `git apply` on the patch inside `dir`, returning git's exit code (0 = applied cleanly).
export function git_applyPatch(dir: string, patchFile: string): number {
  try {
    execFileSync("git", ["apply", patchFile], { cwd: dir, stdio: "pipe" });
    return 0;
  }
  catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

// Every file under `dir` (relative paths, sorted), excluding the .git metadata directory.
export function listRepositoryFiles(dir: string): string[] {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const isFile = entry.isFile();
    const isGitMetadata = join(entry.parentPath).includes("/.git");
    const shouldInclude = isFile && !isGitMetadata;
    if (shouldInclude)
      files.push(relative(dir, join(entry.parentPath, entry.name)));
  }
  return files.sort();
}

// Copy one fixture JSONL into a private temp dir, leaving the shared fixture tree untouched.
export function copyFixtureIntoTempDir(fixturePath: string): Path {
  const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
  const copyPath = join(tempDir, "session.jsonl");
  copyFileSync(fixturePath, copyPath);
  return new Path(copyPath);
}

// Push a file's mtime one second past now.
export function pushFileMtimeByOneSecond(filePath: Path): void {
  const futureSeconds = Date.now() / 1000 + 1;
  utimesSync(filePath.toString(), futureSeconds, futureSeconds);
}

