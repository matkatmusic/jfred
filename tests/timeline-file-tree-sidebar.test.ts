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
    // Steps:
    // build the sidebar view-model from the commit-walk document (alpha 2 revs, beta 1 rev).
    const entries = buildFilesSidebarViewModel(commitWalkDocument);
    assert.deepEqual(entries, [
        { target: "alpha.py", revisionCount: 2, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined },
        { target: "beta.py", revisionCount: 1, isDeleted: false, originalPath: undefined, renameBadgeLabel: undefined },
    ]);
});

test("test_buildFilesSidebarViewModel_flags_a_file_whose_last_revision_is_a_delete", () => {
    // Scenario: a file deleted and never recreated is reported as deleted, so the tree can dim it.
    // Steps:
    // build the sidebar view-model from the item-77 document.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    // find the entry whose history ends in a delete revision.
    const gone = entries.find((entry) => entry.target === "/tmp/proj/src/gone.py");
    // it is reported deleted.
    assert.equal(gone?.isDeleted, true);
});

test("test_buildFilesSidebarViewModel_does_not_flag_a_file_recreated_after_a_delete", () => {
    // Scenario: m4's write->delete->write recreate ends alive, so it must NOT be reported deleted.
    // This guards against testing "any delete revision" instead of the LAST one.
    // Steps:
    // build the sidebar view-model from the item-77 document.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    // find the file that was deleted and then written again.
    const recreated = entries.find((entry) => entry.target === "/tmp/proj/README.md");
    // its last revision is a write, so it is alive.
    assert.equal(recreated?.isDeleted, false);
});

test("test_buildFilesSidebarViewModel_reports_the_original_path_of_a_renamed_file", () => {
    // Scenario: a renamed file is ONE history keyed at its final path (reconstruction_lineage.ts);
    // the pane still needs the path it started life at, for the rename badge.
    // Steps:
    // build the sidebar view-model from the item-77 document.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    // find the renamed file, keyed at its FINAL path.
    const renamed = entries.find((entry) => entry.target === "/tmp/proj/src/renamed.py");
    // its first rename revision's `from` is the path it was born at.
    assert.equal(renamed?.originalPath, "/tmp/proj/src/original.py");
});

test("test_buildFilesSidebarViewModel_reports_no_original_path_for_a_never_renamed_file", () => {
    // Scenario: a file that was never renamed must carry no badge.
    // Steps:
    // build the sidebar view-model from the item-77 document.
    const entries = buildFilesSidebarViewModel(fileTreeDocument);
    // find a file with no rename revision.
    const gone = entries.find((entry) => entry.target === "/tmp/proj/src/gone.py");
    // no original path is reported.
    assert.equal(gone?.originalPath, undefined);
});
