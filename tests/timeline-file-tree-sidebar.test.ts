// buildFilesSidebarViewModel (timeline-file-tree.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilesSidebarViewModel } from "../webapp/views/timeline-file-tree.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { commitWalkDocument } from "./timeline-test-helpers.ts";

// Item 77: absolute targets (production shape — src/reconstruction_extract.ts resolves every
// file_path against the transcript cwd) covering the three cases the Files tree renders specially:
// a rename lineage keyed at its FINAL path (src/reconstruction_lineage.ts), a deleted file, and a
// delete-then-recreate (m4) that ends alive and must NOT read as deleted.

const fileTreeDocument = {
    ...commitWalkDocument,
    filesTouched: [{
        target: "/tmp/proj/src/renamed.py",
        revisions: [
            { kind: EventKind.write, changeId: "c1", timestamp: "2026-01-01T00:00:05.000Z" },
            {
                kind: EventKind.rename,
                changeId: "c2",
                timestamp: "2026-01-01T00:00:06.000Z",
                rename: { from: "/tmp/proj/src/original.py", to: "/tmp/proj/src/renamed.py" },
            },
        ],
    }, {
        target: "/tmp/proj/src/gone.py",
        revisions: [
            { kind: EventKind.write, changeId: "c3", timestamp: "2026-01-01T00:00:07.000Z" },
            { kind: EventKind.delete, changeId: "c4", timestamp: "2026-01-01T00:00:08.000Z" },
        ],
    }, {
        target: "/tmp/proj/README.md",
        revisions: [
            { kind: EventKind.write, changeId: "c5", timestamp: "2026-01-01T00:00:09.000Z" },
            { kind: EventKind.delete, changeId: "c6", timestamp: "2026-01-01T00:00:10.000Z" },
            { kind: EventKind.write, changeId: "c7", timestamp: "2026-01-01T00:00:11.000Z" },
        ],
    }],
};

test("test_buildFilesSidebarViewModel_lists_targets_with_revision_counts", () => {
    // Scenario: the Files sidebar lists every surviving touched file with its revision count.
    const entries = buildFilesSidebarViewModel(commitWalkDocument);
    assert.deepEqual(entries, [
        { target: "alpha.py", revisionCount: 2, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined },
        { target: "beta.py", revisionCount: 1, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined },
    ]);
});

// Task 145: a script move (shutil.move) leaves no rename REVISION — the engine seeds the
// destination's history fresh via the script channels — but the run's sandbox diff proved the
// pair (task 143 renamedPaths), so the badge falls back to it.
const scriptMoveDocument = {
    ...commitWalkDocument,
    filesTouched: [{
        target: "/tmp/proj/core_one.py",
        revisions: [
            { kind: EventKind.write, changeId: "scriptRun:tu1:/tmp/proj/core_one.py", timestamp: "2026-01-01T00:00:05.000Z" },
        ],
    }],
    scriptRuns: [{
        toolUseId: "tu1",
        timestamp: "2026-01-01T00:00:05.000Z",
        code: "import shutil",
        changedPaths: ["/tmp/proj/core_one.py"],
        renamedPaths: [{ from: "/tmp/proj/one.py", to: "/tmp/proj/core_one.py" }],
    }],
};

test("test_buildFilesSidebarViewModel_badges_a_script_move_from_the_runs_rename_pairs", () => {
    // Scenario (task 145): core_one.py's history has no rename revision, but a script run's
    // renamedPaths proves one.py -> core_one.py — the entry still gets its rename badge.
    const entries = buildFilesSidebarViewModel(scriptMoveDocument);
    assert.equal(entries[0]?.originalPath, "/tmp/proj/one.py");
    assert.equal(entries[0]?.renameBadgeLabel, "one.py");
});

test("test_buildFilesSidebarViewModel_reports_no_origin_without_rename_evidence", () => {
    // Scenario (task 145 guard): with no rename revision AND no run pairs, the entry stays
    // badge-less — the fallback must not invent origins.
    const documentWithoutPairs = { ...scriptMoveDocument, scriptRuns: [] };
    const entries = buildFilesSidebarViewModel(documentWithoutPairs);
    assert.equal(entries[0]?.originalPath, undefined);
    assert.equal(entries[0]?.renameBadgeLabel, undefined);
});

test("test_buildFilesSidebarViewModel_flags_a_file_whose_last_revision_is_a_delete", () => {
    // Scenario: a file deleted and never recreated is reported as deleted, so the tree can dim it.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    const gone = entries.find((entry) => entry.target === "/tmp/proj/src/gone.py");
    assert.equal(gone?.isDeleted, true);
});

test("test_buildFilesSidebarViewModel_does_not_flag_a_file_recreated_after_a_delete", () => {
    // Scenario: m4's write->delete->write recreate ends alive, so it must NOT be reported deleted.
    // This guards against testing "any delete revision" instead of the LAST one.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    const recreated = entries.find((entry) => entry.target === "/tmp/proj/README.md");
    assert.equal(recreated?.isDeleted, false);
});

test("test_buildFilesSidebarViewModel_reports_the_original_path_of_a_renamed_file", () => {
    // Scenario: a renamed file is ONE history keyed at its final path (reconstruction_lineage.ts);
    // the pane still needs the path it started life at, for the rename badge.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    const renamed = entries.find((entry) => entry.target === "/tmp/proj/src/renamed.py");
    assert.equal(renamed?.originalPath, "/tmp/proj/src/original.py");
});

test("test_buildFilesSidebarViewModel_reports_no_original_path_for_a_never_renamed_file", () => {
    // Scenario: a file that was never renamed must carry no badge.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    const gone = entries.find((entry) => entry.target === "/tmp/proj/src/gone.py");
    assert.equal(gone?.originalPath, undefined);
});
