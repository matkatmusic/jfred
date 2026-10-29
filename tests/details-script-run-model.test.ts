// Script-run Details view model: changed paths resolve to histories and to the revision showing the run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScriptRunDetailsViewModel } from "../webapp/views/details-script-run-model.ts";
import type { WireFileHistory, WireRevision, WireScriptRun, WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";

function buildRevision(changeId: string, timestamp: string): WireRevision {
    return { kind: "edit", changeId, timestamp };
}

function buildDocument(filesTouched: WireFileHistory[]): WireTimelineDocument {
    return { filesTouched, rewoundFilesTouched: [], messages: [], steps: [], commitMarkers: [] };
}

function buildScriptRun(changedPaths: string[], timestamp: string): WireScriptRun {
    return { toolUseId: "toolu_1", timestamp, code: "print(1)", changedPaths };
}

test("test_buildScriptRunDetailsViewModel_passes_the_code_through", () => {
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun([], "2026-07-01T10:00:00Z"), buildDocument([]));
    assert.equal(viewModel.code, "print(1)");
    assert.deepEqual(viewModel.files, []);
});

test("test_buildScriptRunDetailsViewModel_leaves_an_untracked_path_unresolved", () => {
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun(["/p/a.py"], "2026-07-01T10:00:00Z"), buildDocument([]));
    assert.deepEqual(viewModel.files, [{ path: "/p/a.py", target: undefined, revisionNumber: undefined }]);
});

test("test_buildScriptRunDetailsViewModel_matches_a_cwd_relative_path_to_an_absolute_target", () => {
    const history: WireFileHistory = { target: "/p/src/a.py", revisions: [buildRevision("c1", "2026-07-01T09:00:00Z")] };
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun(["src/a.py"], "2026-07-01T10:00:00Z"), buildDocument([history]));
    assert.equal(viewModel.files[0]!.target, "/p/src/a.py");
});

test("test_buildScriptRunDetailsViewModel_matches_an_absolute_path_to_a_relative_target", () => {
    const history: WireFileHistory = { target: "src/a.py", revisions: [buildRevision("c1", "2026-07-01T09:00:00Z")] };
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun(["/p/src/a.py"], "2026-07-01T10:00:00Z"), buildDocument([history]));
    assert.equal(viewModel.files[0]!.target, "src/a.py");
});

test("test_buildScriptRunDetailsViewModel_prefers_the_revision_stamped_with_the_run_change_id", () => {
    const history: WireFileHistory = {
        target: "/p/a.py",
        revisions: [
            buildRevision("c1", "2026-07-01T12:00:00Z"),
            buildRevision("scriptRun:toolu_1:0", "2026-07-01T13:00:00Z"),
            buildRevision("c3", "2026-07-01T14:00:00Z"),
        ],
    };
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun(["/p/a.py"], "2026-07-01T10:00:00Z"), buildDocument([history]));
    assert.equal(viewModel.files[0]!.revisionNumber, 2);
});

test("test_buildScriptRunDetailsViewModel_falls_back_to_the_first_revision_at_or_after_the_run", () => {
    const history: WireFileHistory = {
        target: "/p/a.py",
        revisions: [buildRevision("c1", "2026-07-01T09:00:00Z"), buildRevision("c2", "2026-07-01T10:00:00Z"), buildRevision("c3", "2026-07-01T11:00:00Z")],
    };
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun(["/p/a.py"], "2026-07-01T10:00:00Z"), buildDocument([history]));
    assert.equal(viewModel.files[0]!.revisionNumber, 2);
});

test("test_buildScriptRunDetailsViewModel_falls_back_to_the_last_revision_when_all_precede_the_run", () => {
    const history: WireFileHistory = {
        target: "/p/a.py",
        revisions: [buildRevision("c1", "2026-07-01T08:00:00Z"), buildRevision("c2", "2026-07-01T09:00:00Z")],
    };
    const viewModel = buildScriptRunDetailsViewModel(buildScriptRun(["/p/a.py"], "2026-07-01T10:00:00Z"), buildDocument([history]));
    assert.equal(viewModel.files[0]!.revisionNumber, 2);
});
