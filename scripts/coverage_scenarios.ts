// Discovery + ground-truth IO for the scenario coverage checker.
// Design: plans/i-need-a-script-peppy-twilight.md (Phase 1).

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { SourceEntry } from "../src/reconstruction_overrides.ts";

// A run can split into several JSONL (a /clear, a git baseline, one per concurrent agent), all
// merged into one record stream. A multi-source capture (s88+) also declares `sources`, one per
// `source-*/projects` tree, so the checker routes through the per-source sidecar reader (spec S7c).
export type CoveredScenario = {
    scenarioId: string;
    dirName: string;
    jsonlPaths: Path[];
    stepStatesDir: string;
    sources?: SourceEntry[];
};

// `.claude` holds harness permission metadata the permission system writes, which has no JSONL
// event or file-history backup and so is outside what the engine reconstructs.
const NON_SOURCE_NAMES = new Set(["manifest.json", "__pycache__", ".pytest_cache", ".claude"]);

export function isDirectory(path: string): boolean {
    return existsSync(path) && statSync(path).isDirectory();
}

// The scenario id prefix of a dir name (s19-user-edit-conv-rewind -> s19), or the whole name if it has no
// leading `<letters><digits>` token.
function scenarioIdOf(dirName: string): string {
    return dirName.match(/^[a-z]+\d+/)?.[0] ?? dirName;
}

// Sorted for deterministic order; all are returned because a split run's sessions merge into one
// record stream at reconstruction.
export function allJsonls(dir: string): string[] {
    const entryNames = readdirSync(dir);
    const jsonlNames = entryNames.filter((name) => name.endsWith(".jsonl"));
    jsonlNames.sort();
    const jsonlPaths = jsonlNames.map((name) => join(dir, name));
    return jsonlPaths;
}

// The per-source trees of a multi-source capture; each also holds a sibling `file-history/`.
export function findSourceTrees(dir: string): string[] {
    const treeNames = readdirSync(dir).filter(
        (name) => name.startsWith("source-") && isDirectory(join(dir, name, "projects")),
    );
    treeNames.sort();
    return treeNames;
}

function allSourceTreeJsonls(dir: string, treeNames: string[]): string[] {
    return treeNames.flatMap((treeName) => {
        const projectsRoot = join(dir, treeName, "projects");
        return readdirSync(projectsRoot)
            .filter((projectName) => isDirectory(join(projectsRoot, projectName)))
            .sort()
            .flatMap((projectName) => allJsonls(join(projectsRoot, projectName)));
    });
}

// With `source-*` trees present the flat root jsonls are IGNORED: they duplicate the same sessions
// and the capture root has no file-history sibling, so loading them falls back to live ~/.claude.
function collectScenarioInputs(dir: string): { jsonls: string[]; sources?: SourceEntry[] } {
    const treeNames = findSourceTrees(dir);
    if (treeNames.length === 0) {
        return { jsonls: allJsonls(dir) };
    }
    const sources = treeNames.map((treeName) => ({ projectsDir: new Path(join(dir, treeName, "projects")) }));
    return { jsonls: allSourceTreeJsonls(dir, treeNames), sources };
}

// A dir with `.step_states` but no jsonl is logged and skipped: nothing to reconstruct from.
export function findCoveredScenarios(executedRoot: URL): CoveredScenario[] {
    const root = fileURLToPath(executedRoot);
    const covered: CoveredScenario[] = [];
    for (const dirName of readdirSync(root)) {
        const dir = join(root, dirName);
        const stepStatesDir = join(dir, ".step_states");
        if (!isDirectory(dir) || !existsSync(stepStatesDir)) {
            continue;
        }
        const { jsonls, sources } = collectScenarioInputs(dir);
        if (jsonls.length === 0) {
            console.warn(`skip ${dirName}: no .jsonl transcript`);
            continue;
        }
        const jsonlPaths = jsonls.map((jsonl) => new Path(jsonl));
        covered.push({ scenarioId: scenarioIdOf(dirName), dirName, jsonlPaths, stepStatesDir, sources });
    }
    return covered;
}

// The in-worktree executed root is the default the CLI and tests both check.
export function listCoveredScenarios(): CoveredScenario[] {
    return findCoveredScenarios(new URL("../scenarios/executed/", import.meta.url));
}

// Scenario dirs with a transcript but no `.step_states`, reported as uncovered (informational).
export function findUncovered(executedRoot: URL, covered: CoveredScenario[]): string[] {
    const root = fileURLToPath(executedRoot);
    const coveredDirs = new Set(covered.map((scenario) => scenario.dirName));
    return readdirSync(root).filter((dirName) => {
        const dir = join(root, dirName);
        return isDirectory(dir) && !coveredDirs.has(dirName) && allJsonls(dir).length > 0;
    });
}

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

// Uuid-less lines are skipped but still counted, so line numbers stay true to the file.
function indexOneJsonl(jsonlPath: Path, index: Map<string, number>): void {
    readFileSync(jsonlPath.toString(), "utf8").split("\n").forEach((line, offset) => {
        const uuid = uuidOfLine(line);
        if (uuid !== undefined) {
            index.set(uuid, offset + 1);
        }
    });
}

// Spans every session jsonl: uuids are globally unique, so the merged index is unambiguous.
export function buildUuidLineIndex(jsonlPaths: Path[]): Map<string, number> {
    console.log(`   Building uuid→line index from ${jsonlPaths.length} JSONL files`);
    const index = new Map<string, number>();
    for (const jsonlPath of jsonlPaths) {
        indexOneJsonl(jsonlPath, index);
    }
    return index;
}

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

// Keyed by path relative to the folder, e.g. "tests/test_x.py".
export function readStepStateFiles(stepDir: string): Map<string, string> {
    const files = new Map<string, string>();
    for (const absolute of walkSourceFiles(stepDir)) {
        files.set(relative(stepDir, absolute), readFileSync(absolute, "utf8"));
    }
    return files;
}

export function stepNumberOf(folderName: string): number {
    return Number(folderName.slice("step-".length));
}

export function stepFolders(stepStatesDir: string): string[] {
    const entryNames = readdirSync(stepStatesDir);
    const stepNames = entryNames.filter((name) => name.startsWith("step-"));
    stepNames.sort((a, b) => stepNumberOf(a) - stepNumberOf(b));
    return stepNames;
}

