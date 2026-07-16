// Discovery + ground-truth IO for the scenario coverage checker: enumerate scenarios that have captured
// `.step_states`, index a transcript's record uuids to line numbers, and read a step folder's source files.
// Design: plans/i-need-a-script-peppy-twilight.md (Phase 1).

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { Path } from "../src/structures/domain.ts";

// A scenario that has captured ground truth: its id (s19), dir name, all session transcripts, and
// `.step_states` dir. A run can split into several JSONL — pre/post a /clear, baseline + scenario for a
// git-baseline, one per agent for a concurrent run — all merged into one record stream at reconstruction.
export type CoveredScenario = {
    scenarioId: string;
    dirName: string;
    jsonlPaths: Path[];
    stepStatesDir: string;
};

// Names that are never scenario source files in a `.step_states` folder: the capture manifest, the
// Python caches, and `.claude` (harness permission/config metadata, e.g. settings.local.json written by
// Claude Code's permission system on first MCP-tool use — not an agent edit, has no JSONL event or
// file-history backup, so it is outside what the engine reconstructs from the transcript).
const NON_SOURCE_NAMES = new Set(["manifest.json", "__pycache__", ".pytest_cache", ".claude"]);

// Whether a path is a directory (false for files / dangling entries).
export function isDirectory(path: string): boolean {
    return existsSync(path) && statSync(path).isDirectory();
}

// The scenario id prefix of a dir name (s19-user-edit-conv-rewind -> s19), or the whole name if it has no
// leading `<letters><digits>` token.
function scenarioIdOf(dirName: string): string {
    return dirName.match(/^[a-z]+\d+/)?.[0] ?? dirName;
}

// Every `*.jsonl` in a dir, sorted for deterministic order — the scenario's session transcript(s). Several
// arise when a run splits into multiple sessions (pre/post /clear, baseline + scenario, one per concurrent
// agent); they are merged into one record stream at reconstruction, so all are returned.
export function allJsonls(dir: string): string[] {
    const entryNames = readdirSync(dir);
    const jsonlNames = entryNames.filter((name) => name.endsWith(".jsonl"));
    jsonlNames.sort();
    const jsonlPaths = jsonlNames.map((name) => join(dir, name));
    return jsonlPaths;
}

// Every scenario under `executedRoot` that has a `.step_states/` dir AND at least one transcript. A dir with
// `.step_states` but no jsonl is logged and skipped (nothing to reconstruct from).
export function findCoveredScenarios(executedRoot: URL): CoveredScenario[] {
    const root = fileURLToPath(executedRoot);
    const covered: CoveredScenario[] = [];
    for (const dirName of readdirSync(root)) {
        const dir = join(root, dirName);
        const stepStatesDir = join(dir, ".step_states");
        if (!isDirectory(dir) || !existsSync(stepStatesDir)) {
            continue;
        }
        const jsonls = allJsonls(dir);
        if (jsonls.length === 0) {
            console.warn(`skip ${dirName}: no .jsonl transcript`);
            continue;
        }
        const jsonlPaths = jsonls.map((jsonl) => new Path(jsonl));
        covered.push({ scenarioId: scenarioIdOf(dirName), dirName, jsonlPaths, stepStatesDir });
    }
    return covered;
}

// Every covered scenario under the in-worktree executed root (the default the CLI and tests both check).
export function listCoveredScenarios(): CoveredScenario[] {
    return findCoveredScenarios(new URL("../scenarios/executed/", import.meta.url));
}

// The scenario dir names that have a jsonl transcript but no `.step_states` — reported as uncovered
// (informational).
export function findUncovered(executedRoot: URL, covered: CoveredScenario[]): string[] {
    const root = fileURLToPath(executedRoot);
    const coveredDirs = new Set(covered.map((scenario) => scenario.dirName));
    return readdirSync(root).filter((dirName) => {
        const dir = join(root, dirName);
        return isDirectory(dir) && !coveredDirs.has(dirName) && allJsonls(dir).length > 0;
    });
}

// The uuid of one JSONL line, or undefined when the line is blank / not JSON / carries no uuid.
function uuidOfLine(line: string): string | undefined {
    if (line.trim().length === 0) {
        return undefined;
    }
    try {
        const uuid = (JSON.parse(line) as { uuid?: unknown }).uuid;
        return typeof uuid === "string" ? uuid : undefined;
    } catch {
        return undefined;
    }
}

// Index one jsonl file's uuids into `index` by 1-based line number. Non-JSON/uuid-less lines are skipped
// but still counted (line numbers stay true to the file).
function indexOneJsonl(jsonlPath: Path, index: Map<string, number>): void {
    readFileSync(jsonlPath.toString(), "utf8").split("\n").forEach((line, offset) => {
        const uuid = uuidOfLine(line);
        if (uuid !== undefined) {
            index.set(uuid, offset + 1);
        }
    });
}

// A map from each transcript record's uuid to its 1-based line number, for attributing a step to its JSONL
// line. Spans every session jsonl (uuids are globally unique, so the merged index is unambiguous).
export function buildUuidLineIndex(jsonlPaths: Path[]): Map<string, number> {
    console.log(`   Building uuid→line index from ${jsonlPaths.length} JSONL files`);
    const index = new Map<string, number>();
    for (const jsonlPath of jsonlPaths) {
        indexOneJsonl(jsonlPath, index);
    }
    return index;
}

// Every source file under `dir`, recursively, skipping manifest.json / __pycache__ / .pytest_cache.
function walkSourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const name of readdirSync(dir)) {
        if (NON_SOURCE_NAMES.has(name)) {
            continue;
        }
        const absolute = join(dir, name);
        found.push(...(isDirectory(absolute) ? walkSourceFiles(absolute) : [absolute]));
    }
    return found;
}

// The source-file contents of a `.step_states/step-NNN` folder, keyed by path relative to the folder
// (e.g. "tests/test_x.py"). Skips manifest.json and the Python cache dirs.
export function readStepStateFiles(stepDir: string): Map<string, string> {
    const files = new Map<string, string>();
    for (const absolute of walkSourceFiles(stepDir)) {
        files.set(relative(stepDir, absolute), readFileSync(absolute, "utf8"));
    }
    return files;
}

// The 1-based step number a `step-NNN` folder name encodes.
export function stepNumberOf(folderName: string): number {
    return Number(folderName.slice("step-".length));
}

// The sorted `step-NNN` folder names under a `.step_states` dir.
export function stepFolders(stepStatesDir: string): string[] {
    const entryNames = readdirSync(stepStatesDir);
    const stepNames = entryNames.filter((name) => name.startsWith("step-"));
    stepNames.sort((a, b) => stepNumberOf(a) - stepNumberOf(b));
    return stepNames;
}

