import { readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, copyFileSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseRecord } from "../src/parse/parseRecord.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";
// Moved to fixtures.ts (task 64): every capture-dependent helper lives there, so this module —
// and the many capture-free tests importing it — stays runnable on a clone without the executed
// scenario captures. Commented originals below; delete once the moved suite is confirmed green.
// import { listCoveredScenarios } from "../scripts/coverage_scenarios.ts";

// export function jsonlPathsForScenario(scenarioId: string): Path[] {
//     const scenario = listCoveredScenarios().find((covered) => covered.scenarioId === scenarioId);
//     if (scenario === undefined) {
//         throw new Error(`no covered scenario with id ${scenarioId}`);
//     }
//     return scenario.jsonlPaths;
// }

// Read a text file and return its non-empty lines — the shared JSONL line reader
// used across the transcript tests. Generic: takes any file path.
export function readNonEmptyLines(file: string): string[] {
    const fileText = readFileSync(file, "utf8");
    const lines = fileText.split("\n");
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    return nonEmptyLines;
}

// Parse every non-empty line of a transcript JSONL file into typed records (no
// field gate; use loadTranscript for the gated path). Generic: takes any path.
export function loadRecords(file: string): TranscriptRecord[] {
    return readNonEmptyLines(file).map(parseRecord);
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

// Write a step snapshot's files (absolute-keyed) into `intoDir`, relativized against `root` —
// the same relativization renderRangePatch applies to its patch paths.
export function materializeSnapshotIntoDirectory(files: Record<string, string>, root: string, intoDir: string): void {
    for (const [absolutePath, content] of Object.entries(files)) {
        const destination = join(intoDir, relative(root, absolutePath));
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, content);
    }
}

// Turn `dir` into a git repository with everything committed (identity pinned so the commit
// succeeds regardless of local git config; --allow-empty covers the empty before-state).
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
    } catch (error) {
        return (error as { status?: number }).status ?? 1;
    }
}

// Every file under `dir` (relative paths, sorted), excluding the .git metadata directory.
export function listRepositoryFiles(dir: string): string[] {
    const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && !join(entry.parentPath).includes("/.git"));
    return files.map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();
}

// A private temp copy of one fixture JSONL, so mtime edits and cache-coldness needs never
// touch the shared fixture tree (a fresh path = a fresh transcript-set stamp).
export function copyFixtureIntoTempDir(fixturePath: string): Path {
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-artifact-"));
    const copyPath = join(tempDir, "session.jsonl");
    copyFileSync(fixturePath, copyPath);
    return new Path(copyPath);
}

// Push a file's mtime one second past NOW — the smallest change the stamp must notice.
export function advanceFileMtimeByOneSecond(filePath: Path): void {
    const futureSeconds = Date.now() / 1000 + 1;
    utimesSync(filePath.toString(), futureSeconds, futureSeconds);
}

