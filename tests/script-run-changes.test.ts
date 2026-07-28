// The document's scriptRuns[] (task 67): each recorded run plus the files its consented sandbox
// execution changed. Fixture s25 is one Bash run rewriting several files in a single execution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import type { ReconstructionDocument } from "../src/reconstruction_json.ts";
import { matchRenamePairs } from "../src/reconstruction_script_renames.ts";
import { setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { Path } from "../src/structures/domain.ts";
import { S25_JSONL, S85_JSONL_PATHS } from "./fixtures.ts";

function computeBasename(value: string): string {
    return value.split("/").pop() ?? value;
}

function assertChangedPathsAreDomainPaths(runs: { changedPaths: Path[] }[]): void {
    for (const changed of runs.flatMap((run) => run.changedPaths)) {
        assert.ok(changed instanceof Path);
    }
}

// The viewer's consented-build lifecycle: gate on for the build's own duration, off after.
function buildConsentedS25Document(): ReconstructionDocument {
    setImpureExecutionAllowed(true);
    try {
        return buildProjectDocument([new Path(S25_JSONL)], undefined);
    } finally {
        setImpureExecutionAllowed(false);
    }
}

test("test_declined_build_lists_script_runs_with_empty_changed_paths", () => {
    // A declined build still lists every run (the consent dialog needs the code) but reports nothing
    // changed. The gate DEFAULTS ON for CLI/tests, so it is restored afterwards.
    setImpureExecutionAllowed(false);
    let document: ReconstructionDocument;
    try {
        document = buildProjectDocument([new Path(S25_JSONL)], undefined);
    } finally {
        setImpureExecutionAllowed(true);
    }
    assert.ok(document.scriptRuns.length > 0);
    for (const run of document.scriptRuns) {
        assert.ok(run.code.length > 0);
        assert.ok(run.timestamp instanceof Date);
        assert.deepEqual(run.changedPaths, []);
    }
});

test("test_consented_build_reports_script_changed_paths", () => {
    // A consented build executes the runs, so s25's multi-file rename reports 2+ changed files.
    const document = buildConsentedS25Document();
    const modifyingRuns = document.scriptRuns.filter((run) => run.changedPaths.length >= 2);
    assert.ok(modifyingRuns.length >= 1);
    assertChangedPathsAreDomainPaths(document.scriptRuns);
});

test("test_match_rename_pairs_pairs_deleted_source_with_created_destination_by_content", () => {
    // Task 143: a shutil.move reports both sides, and identical content across the pair proves it.
    const preState = new Map([["one.py", "A"], ["keep.py", "K"]]);
    const postState = new Map([["core_one.py", "A"], ["keep.py", "K2"]]);
    assert.deepEqual(matchRenamePairs(preState, postState), [{ fromKey: "one.py", toKey: "core_one.py" }]);
});

test("test_match_rename_pairs_pairs_each_source_once_on_duplicate_content", () => {
    // Task 143: with two identical deleted files and one destination, the other stays a deletion.
    const preState = new Map([["a.py", "same"], ["b.py", "same"]]);
    const postState = new Map([["c.py", "same"]]);
    const pairs = matchRenamePairs(preState, postState);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]!.toKey, "c.py");
});

test("test_match_rename_pairs_ignores_content_edits_in_place", () => {
    // Task 143: a file present in both states with different content is a modification.
    const preState = new Map([["a.py", "old"]]);
    const postState = new Map([["a.py", "new"]]);
    assert.deepEqual(matchRenamePairs(preState, postState), []);
});

test("test_s85_move_run_collapses_rename_pairs_and_reports_them", () => {
    // Task 143: the sandbox diff used to report all 6 paths; a rename pair is ONE move, so
    // changedPaths collapses to the 3 destinations and the pairs ride alongside.
    setImpureExecutionAllowed(true);
    let document: ReconstructionDocument;
    try {
        document = buildProjectDocument(S85_JSONL_PATHS, undefined);
    } finally {
        setImpureExecutionAllowed(false);
    }
    const moveRun = document.scriptRuns.find((run) => run.renamedPaths.length > 0);
    assert.ok(moveRun !== undefined);
    assert.equal(moveRun.renamedPaths.length, 3);
    const fromBasenames = moveRun.renamedPaths.map((pair) => computeBasename(pair.from.toString())).sort();
    assert.deepEqual(fromBasenames, ["one.py", "three.py", "two.py"]);
    const toBasenames = moveRun.renamedPaths.map((pair) => computeBasename(pair.to.toString())).sort();
    assert.deepEqual(toBasenames, ["core_one.py", "core_three.py", "core_two.py"]);
    assert.equal(moveRun.changedPaths.length, 3);
    const changedBasenames = moveRun.changedPaths.map((changed) => computeBasename(changed.toString())).sort();
    assert.deepEqual(changedBasenames, ["core_one.py", "core_three.py", "core_two.py"]);
});

test("test_script_changed_paths_name_files_the_document_tracks", () => {
    // The webapp joins changedPaths to filesTouched by BASENAME, because the sandbox's state keys
    // may still be cwd-relative before resolution.
    const document = buildConsentedS25Document();
    const trackedBasenames = new Set(
        document.filesTouched.map((history) => computeBasename(history.target.toString())),
    );
    const modifyingRun = document.scriptRuns.find((run) => run.changedPaths.length >= 2);
    assert.ok(modifyingRun !== undefined);
    for (const changed of modifyingRun.changedPaths) {
        assert.ok(trackedBasenames.has(computeBasename(changed.toString())));
    }
});
