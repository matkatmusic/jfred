// renderRangePatch: a picked contiguous step range exports as ONE git-apply-able unified diff.
// The acceptance gate is a real `git apply` round-trip — the patch applied onto the materialized
// before-state must reproduce the after-state byte for byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectReconstruction } from "../src/viewer_api.ts";
import { renderRangePatch, computePatchRoot, parseRangePatchQuery, resolveStepFiles, parseStepFilesQuery } from "../src/viewer_api_diffs.ts";
import { resolveFilesAtStep } from "../src/reconstruction_steps.ts";
import { S85_JSONL_PATHS } from "./fixtures.ts";
import {
    materializeSnapshotIntoDirectory,
    git_initRepositoryWithCommit,
    git_applyPatch,
    listRepositoryFiles,
} from "./utilities.ts";

// Built once — every test here reads the same s85 reconstruction (one session, real git commits,
// moves). Step snapshots are skeletons now; a step's files are resolved on demand from the histories.
const { document: s85Document, stepFileHistories: s85Histories } = buildProjectReconstruction(S85_JSONL_PATHS, undefined);

// The { path: content } map for a 1-based step, resolved from the compact histories (the on-demand
// replacement for the removed per-step `files` map).
function filesAtStep(stepNumber: number): Record<string, string> {
    return resolveFilesAtStep(s85Histories, s85Document.steps[stepNumber - 1]!.when);
}

// The last step index before s85's first commit marker (steps and markers are both chronological).
function findLastStepBeforeFirstCommit(): number {
    const firstCommitMs = Math.min(...s85Document.commitMarkers.map((marker) => marker.timestamp.getTime()));
    return s85Document.steps.filter((step) => step.when.getTime() < firstCommitMs).length;
}

test("test_range_patch_applies_cleanly_and_reproduces_after_state", () => {
    // Scenario: the exported patch, applied with real `git apply` onto the before-state,
    //           reproduces the after-state exactly. Proves git-commit-point usability.
    // Steps:
    // build s85's unified document.
    // choose fromStep=1, toStep=<last step index before the first commit marker>.
    // materialize the BEFORE snapshot into a fresh temp dir; `git init` it; `git add -A; git commit`.
    // write renderRangePatch(document, fromStep, toStep) to a .patch file.
    // run `git apply <patch>` in the temp repo; assert exit code 0.
    // for every path in the AFTER snapshot: assert the on-disk file equals the snapshot content.
    // assert no extra files exist beyond the AFTER snapshot's paths.
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
    // Scenario: out-of-range or inverted step indexes are rejected loudly, never clamped.
    // Steps:
    // assert renderRangePatch throws on fromStep < 1.
    // assert it throws on toStep > steps.length.
    // assert it throws on fromStep > toStep.
    const stepCount = s85Document.steps.length;
    assert.throws(() => renderRangePatch(s85Histories, s85Document.steps, 0, 1));
    assert.throws(() => renderRangePatch(s85Histories, s85Document.steps, 1, stepCount + 1));
    assert.throws(() => renderRangePatch(s85Histories, s85Document.steps, 3, 2));
});

test("test_range_patch_covers_renamed_files_in_s85", () => {
    // Scenario: a range spanning s85's move operations patches in the moved-to files. Since task
    // 155 the engine models these moves as TRUE rename revisions (source history merges into the
    // destination), so the patch must create every destination AND carry the moved-away source's
    // own diff block (its rename/removal) — sources no longer persist as untouched originals.
    // Steps:
    // find the first step that tracks a core_* destination; patch from the step before it to the end.
    // assert the patch creates each core_* destination.
    // assert the moved-away source gets its own diff block (task 155 rename revisions).
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

test("test_resolveStepFiles_returns_the_repo_map_at_a_step_and_rejects_out_of_range", () => {
    // Scenario: /api/step-files' core — the repo file map at a 1-based step, resolved on demand from the
    // histories, equal to the same step's files; out-of-range steps throw (the server maps throws to 400).
    // Steps:
    // resolve the last step's files via resolveStepFiles; assert it equals filesAtStep and is non-empty.
    // assert step 0 and step (count+1) each throw.
    const stepCount = s85Document.steps.length;
    const filesAtLast = resolveStepFiles(s85Histories, s85Document.steps, stepCount);
    assert.deepEqual(filesAtLast, filesAtStep(stepCount));
    assert.ok(Object.keys(filesAtLast).length > 0);
    assert.throws(() => resolveStepFiles(s85Histories, s85Document.steps, 0));
    assert.throws(() => resolveStepFiles(s85Histories, s85Document.steps, stepCount + 1));
});

test("test_step_files_endpoint_parses_positive_step", () => {
    // Scenario: /api/step-files' trust boundary — `step` is a required 1-based positive integer, the
    // server maps every other value to a 400 via a loud throw.
    assert.deepEqual(parseStepFilesQuery(new URLSearchParams("step=3")), { step: 3 });
    assert.throws(() => parseStepFilesQuery(new URLSearchParams("")));
    assert.throws(() => parseStepFilesQuery(new URLSearchParams("step=0")));
    assert.throws(() => parseStepFilesQuery(new URLSearchParams("step=1.5")));
});

test("test_range_patch_endpoint_returns_patch_text", () => {
    // Scenario: /api/range-patch's trust boundary — the query parser (the endpoint's only logic
    // beyond the already-tested build + render composition) accepts 1-based positive integers and
    // rejects everything else loudly (the server maps throws to 400).
    // Steps:
    // parse a valid query; assert the numeric pair comes back.
    // assert missing, non-integer, fractional, and sub-1 params each throw.
    const parsed = parseRangePatchQuery(new URLSearchParams("fromStep=2&toStep=5"));
    assert.deepEqual(parsed, { fromStep: 2, toStep: 5 });
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("toStep=5")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=2")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=abc&toStep=5")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=1.5&toStep=5")));
    assert.throws(() => parseRangePatchQuery(new URLSearchParams("fromStep=0&toStep=5")));
});

