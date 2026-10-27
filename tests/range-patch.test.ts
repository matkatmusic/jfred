// renderRangePatch: a step range exports as one unified diff that `git apply` accepts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectReconstruction } from "../src/viewer_api.ts";
import { renderRangePatch, computePatchRoot, parseRangePatchQuery, computeStepFiles, parseStepFilesQuery } from "../src/viewer_api_diffs.ts";
import { computeFilesAtStep } from "../src/reconstruction_steps.ts";
import { S85_JSONL_PATHS } from "./fixtures.ts";
import {
    materializeSnapshotIntoDirectory,
    git_initRepositoryWithCommit,
    git_applyPatch,
    listRepositoryFiles,
} from "./utilities.ts";

// Built once: every test reads the same s85 reconstruction.
const { document: s85Document, stepFileHistories: s85Histories } = buildProjectReconstruction(S85_JSONL_PATHS, undefined);

// The { path: content } map for a 1-based step, resolved from the histories.
function filesAtStep(stepNumber: number): Record<string, string> {
    return computeFilesAtStep(s85Histories, s85Document.steps[stepNumber - 1]!.when);
}

// The last step index before s85's first commit marker (steps and markers are both chronological).
function findLastStepBeforeFirstCommit(): number {
    const firstCommitMs = Math.min(...s85Document.commitMarkers.map((marker) => marker.timestamp.getTime()));
    return s85Document.steps.filter((step) => step.when.getTime() < firstCommitMs).length;
}

test("test_range_patch_applies_cleanly_and_reproduces_after_state", () => {
    // Scenario: `git apply` of the patch onto the before-state reproduces the after-state exactly.
    const fromStep = 1;
    const toStep = findLastStepBeforeFirstCommit();
    assert.ok(toStep >= 1);
    const beforeFiles = fromStep >= 2 ? filesAtStep(fromStep - 1) : {};
    const afterFiles = filesAtStep(toStep);
    const root = computePatchRoot(s85Histories);

    const workDir = mkdtempSync(join(tmpdir(), "range-patch-"));
    const repoDir = join(workDir, "repo");
    mkdirSync(repoDir);
    materializeSnapshotIntoDirectory(beforeFiles, root, repoDir);
    git_initRepositoryWithCommit(repoDir);

    const patchFile = join(workDir, "range.patch");
    writeFileSync(patchFile, renderRangePatch(s85Histories, s85Document.steps, fromStep, toStep));
    assert.equal(git_applyPatch(repoDir, patchFile), 0);

    for (const [absolutePath, content] of Object.entries(afterFiles)) {
        assert.equal(readFileSync(join(repoDir, relative(root, absolutePath)), "utf8"), content);
    }
    const expectedFiles = Object.keys(afterFiles).map((key) => relative(root, key)).sort();
    assert.deepEqual(listRepositoryFiles(repoDir), expectedFiles);
});

test("test_range_patch_rejects_indices_out_of_range", () => {
    // Scenario: out-of-range or inverted step indexes throw and are never clamped.
    const stepCount = s85Document.steps.length;
    assert.throws(() => renderRangePatch(s85Histories, s85Document.steps, 0, 1));
    assert.throws(() => renderRangePatch(s85Histories, s85Document.steps, 1, stepCount + 1));
    assert.throws(() => renderRangePatch(s85Histories, s85Document.steps, 3, 2));
});

test("test_range_patch_covers_renamed_files_in_s85", () => {
    // Scenario: a range over s85's moves creates each destination and carries the moved-away source's diff block.
    const moveStep = s85Document.steps.find((step) =>
        Object.keys(filesAtStep(step.index)).some((path) => path.includes("core_one.py")),
    );
    assert.ok(moveStep !== undefined);
    const patch = renderRangePatch(s85Histories, s85Document.steps, moveStep.index, s85Document.steps.length);
    for (const destination of ["core_one.py", "core_two.py", "core_three.py"]) {
        assert.ok(patch.includes(`+++ b/${destination}`));
    }
    assert.ok(patch.includes("diff --git a/one.py"));
});

test("test_computeStepFiles_returns_the_repo_map_at_a_step_and_rejects_out_of_range", () => {
    // Scenario: computeStepFiles returns the repo map at a 1-based step and throws out of range.
    const stepCount = s85Document.steps.length;
    const filesAtLast = computeStepFiles(s85Histories, s85Document.steps, stepCount);
    assert.deepEqual(filesAtLast, filesAtStep(stepCount));
    assert.ok(Object.keys(filesAtLast).length > 0);
    assert.throws(() => computeStepFiles(s85Histories, s85Document.steps, 0));
    assert.throws(() => computeStepFiles(s85Histories, s85Document.steps, stepCount + 1));
});

test("test_step_files_endpoint_parses_positive_step", () => {
    // Scenario: `step` is a required 1-based positive integer; every other value throws.
    assert.deepEqual(parseStepFilesQuery(new URLSearchParams("step=3")), { step: 3 });
    assert.throws(() => parseStepFilesQuery(new URLSearchParams("")));
    assert.throws(() => parseStepFilesQuery(new URLSearchParams("step=0")));
    assert.throws(() => parseStepFilesQuery(new URLSearchParams("step=1.5")));
});

test("test_range_patch_endpoint_returns_patch_text", () => {
    // Scenario: the query parser accepts 1-based positive integers and throws on everything else.
    const parsed = parseRangePatchQuery(new URLSearchParams("fromStep=2&toStep=5"));
    assert.deepEqual(parsed, { fromStep: 2, toStep: 5 });
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("toStep=5")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=2")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=abc&toStep=5")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=1.5&toStep=5")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=0&toStep=5")));
});

