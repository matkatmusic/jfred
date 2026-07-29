// Spec S7c (task 178): coverage-checker discovery of multi-source captures. A scenario dir holding `source-*/projects` trees (s88+) yields the trees' jsonls + one bare {projectsDir} source per tree, ignoring the flat auto-capture duplicates at the scenario root; a flat scenario dir is unchanged.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findCoveredScenarios, findSourceTrees } from "../scripts/coverage_scenarios.ts";

const executedRoot = mkdtempSync(join(tmpdir(), "coverage-scenarios-test-"));

after(() => rmSync(executedRoot, { recursive: true, force: true }));

// One fake jsonl line — discovery only globs file names, it never parses content.
const JSONL_LINE = `${JSON.stringify({ type: "user", uuid: "u1" })}\n`;

function makeStepStates(scenarioDir: string): void {
    const stepDir = join(scenarioDir, ".step_states", "step-001");
    mkdirSync(stepDir, { recursive: true });
    writeFileSync(join(stepDir, "x.py"), "print(1)\n");
}

function makeMultiSourceScenario(): string {
    const dir = join(executedRoot, "s99-fake-multi");
    makeStepStates(dir);
    for (const [tree, jsonlName] of [["source-a1", "aaaa.jsonl"], ["source-a2", "bbbb.jsonl"]] as const) {
        const projectDir = join(dir, tree, "projects", "-tmp-fake");
        mkdirSync(projectDir, { recursive: true });
        writeFileSync(join(projectDir, jsonlName), JSONL_LINE);
    }
    writeFileSync(join(dir, "cccc.jsonl"), JSONL_LINE); // flat auto-capture duplicate — must be ignored
    return dir;
}

function makeFlatScenario(): string {
    const dir = join(executedRoot, "s98-fake-flat");
    makeStepStates(dir);
    writeFileSync(join(dir, "dddd.jsonl"), JSONL_LINE);
    return dir;
}

const multiDir = makeMultiSourceScenario();
makeFlatScenario();
const covered = findCoveredScenarios(pathToFileURL(executedRoot + "/"));

test("multi-source scenario: sources are the sorted source-* trees' projects roots", () => {
    const multi = covered.find((scenario) => scenario.scenarioId === "s99");
    assert.ok(multi);
    assert.equal(multi.sources?.length, 2);
    assert.deepEqual(
        multi.sources?.map((source) => source.projectsDir.toString()),
        [join(multiDir, "source-a1", "projects"), join(multiDir, "source-a2", "projects")],
    );
});

test("multi-source scenario: jsonls come from the source trees, never the flat root", () => {
    const multi = covered.find((scenario) => scenario.scenarioId === "s99");
    assert.deepEqual(
        multi?.jsonlPaths.map((path) => path.toString()),
        [
            join(multiDir, "source-a1", "projects", "-tmp-fake", "aaaa.jsonl"),
            join(multiDir, "source-a2", "projects", "-tmp-fake", "bbbb.jsonl"),
        ],
    );
});

test("flat scenario keeps the existing single-source shape: root jsonls, no sources", () => {
    const flat = covered.find((scenario) => scenario.scenarioId === "s98");
    assert.ok(flat);
    assert.equal(flat.sources, undefined);
    assert.deepEqual(
        flat.jsonlPaths.map((path) => path.toString()),
        [join(executedRoot, "s98-fake-flat", "dddd.jsonl")],
    );
});

test("findSourceTrees requires a projects dir inside the source-* dir", () => {
    const dir = join(executedRoot, "s97-fake-decoy");
    mkdirSync(join(dir, "source-empty"), { recursive: true });
    assert.deepEqual(findSourceTrees(dir), []);
});
