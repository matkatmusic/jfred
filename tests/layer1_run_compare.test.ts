// No Docker: the replayed post state is given by hand, so only the proof rules run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { compareChangedFiles, createCompareContext, findRunConfidence, listChangedFiles } from "../src/layer1_run_compare.ts";
import { loadReplayRun } from "../src/layer1_run_start_files.ts";
import {
    APPEND_Y_SCRIPT,
    APPEND_Z_SCRIPT,
    addFullRead,
    addScriptRun,
    addWrite,
    createCraftedProject,
    writeCraftedSession,
    writeProjectFile,
    type CraftedProject,
} from "./layer1_run_test_helpers.ts";

const REPLAYED: [string, string][] = [["a.txt", "a\nz\n"]];

// Write a.txt (s1), then the run under test (s5); `extend` adds what happens after the run.
function compareReplayedFile(extend: (project: CraftedProject) => void) {
    const project = createCraftedProject();
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_T", 5, { code: APPEND_Z_SCRIPT });
    extend(project);
    const input = writeCraftedSession(project, "toolu_T");
    const context = createCompareContext(input, loadReplayRun(input));
    return { project, files: compareChangedFiles(context, REPLAYED) };
}

test("test_compareChangedFiles_is_verified_when_the_nearest_beacon_is_equal", () => {
    const { files } = compareReplayedFile((project) => addFullRead(project, "toolu_r", 10, "a.txt", "a\nz\n"));
    assert.deepEqual(files, [{ path: "a.txt", confidence: WireConfidence.verified }]);
});

test("test_compareChangedFiles_is_mismatch_when_the_nearest_beacon_differs", () => {
    const { files } = compareReplayedFile((project) => addFullRead(project, "toolu_r", 10, "a.txt", "a\nQ\n"));
    assert.deepEqual(files, [{ path: "a.txt", confidence: WireConfidence.mismatch }]);
});

test("test_compareChangedFiles_without_a_beacon_is_verified_when_the_working_tree_matches", () => {
    const project = createCraftedProject();
    writeProjectFile(project, "a.txt", "a\nz\n");
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_T", 5, { code: APPEND_Z_SCRIPT });
    const input = writeCraftedSession(project, "toolu_T");
    const files = compareChangedFiles(createCompareContext(input, loadReplayRun(input)), REPLAYED);
    assert.deepEqual(files, [{ path: "a.txt", confidence: WireConfidence.verified }]);
});

test("test_compareChangedFiles_without_a_beacon_ignores_a_different_or_missing_working_tree", () => {
    const project = createCraftedProject();
    writeProjectFile(project, "a.txt", "different\n");
    addWrite(project, "toolu_w", 1, "a.txt", "a\n");
    addScriptRun(project, "toolu_T", 5, { code: APPEND_Z_SCRIPT });
    const input = writeCraftedSession(project, "toolu_T");
    const context = createCompareContext(input, loadReplayRun(input));
    assert.equal(compareChangedFiles(context, REPLAYED)[0]!.confidence, WireConfidence.injectedUnverified);
    rmSync(join(project.dir, "a.txt"));
    assert.equal(compareChangedFiles(context, REPLAYED)[0]!.confidence, WireConfidence.injectedUnverified);
});

test("test_compareChangedFiles_a_write_between_the_run_and_the_beacon_gives_injected_unverified_not_mismatch", () => {
    const { files } = compareReplayedFile((project) => {
        addWrite(project, "toolu_w2", 7, "a.txt", "other\n");
        addFullRead(project, "toolu_r", 10, "a.txt", "other\n");
    });
    assert.equal(files[0]!.confidence, WireConfidence.injectedUnverified);
});

test("test_compareChangedFiles_another_script_run_of_the_path_between_gives_injected_unverified", () => {
    const { files } = compareReplayedFile((project) => {
        addScriptRun(project, "toolu_O", 7, { code: APPEND_Y_SCRIPT });
        addFullRead(project, "toolu_r", 10, "a.txt", "a\nz\ny\n");
    });
    assert.equal(files[0]!.confidence, WireConfidence.injectedUnverified);
});

test("test_compareChangedFiles_leaves_out_a_file_outside_the_project_folder", () => {
    const project = createCraftedProject();
    addScriptRun(project, "toolu_T", 5, { code: APPEND_Z_SCRIPT });
    const input = writeCraftedSession(project, "toolu_T");
    const context = createCompareContext(input, loadReplayRun(input));
    assert.deepEqual(compareChangedFiles(context, [["../elsewhere.txt", "x"]]), []);
});

test("test_listChangedFiles_keeps_changed_and_new_files_and_drops_unchanged_and_junk", () => {
    const pre = new Map([["same.txt", "1"], ["changed.txt", "1"]]);
    const post = new Map([["same.txt", "1"], ["changed.txt", "2"], ["new.txt", "3"], ["__pycache__/x.pyc", "4"], ["mod.pyc", "5"]]);
    assert.deepEqual(listChangedFiles(post, pre), [["changed.txt", "2"], ["new.txt", "3"]]);
});

test("test_findRunConfidence_is_the_worst_of_the_files_and_undefined_for_none", () => {
    const files = (...confidences: WireConfidence[]) => confidences.map((confidence) => ({ path: "x", confidence }));
    assert.equal(findRunConfidence(files(WireConfidence.verified, WireConfidence.injectedUnverified)), WireConfidence.injectedUnverified);
    assert.equal(findRunConfidence(files(WireConfidence.verified, WireConfidence.mismatch, WireConfidence.injectedUnverified)), WireConfidence.mismatch);
    assert.equal(findRunConfidence([]), undefined);
});
