// findScriptRenameSource and applyRenameBadgeLabels (timeline-file-badges.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRenameBadgeLabels, findScriptRenameSource } from "../webapp/views/timeline-file-badges.ts";
import type { FileSidebarEntry } from "../webapp/views/timeline-file-tree-sidebar.ts";
import { commitWalkDocument } from "./timeline-test-helpers.ts";

const documentWithRunPair = {
    ...commitWalkDocument,
    scriptRuns: [{
        toolUseId: "tu1",
        timestamp: "2026-01-01T00:00:05.000Z",
        code: "import shutil",
        changedPaths: [],
        renamedPaths: [{ from: "/tmp/proj/one.py", to: "/tmp/proj/core_one.py" }],
    }],
};

test("test_findScriptRenameSource_matches_a_destination_exactly", () => {
    assert.equal(findScriptRenameSource(documentWithRunPair, "/tmp/proj/core_one.py"), "/tmp/proj/one.py");
});

test("test_findScriptRenameSource_matches_a_trailing_segment_destination", () => {
    assert.equal(findScriptRenameSource(documentWithRunPair, "/work/tmp/proj/core_one.py"), undefined);
    const relativeDocument = {
        ...documentWithRunPair,
        scriptRuns: [{ ...documentWithRunPair.scriptRuns[0]!, renamedPaths: [{ from: "one.py", to: "core_one.py" }] }],
    };
    assert.equal(findScriptRenameSource(relativeDocument, "/tmp/proj/core_one.py"), "one.py");
});

test("test_findScriptRenameSource_returns_undefined_without_a_matching_pair", () => {
    assert.equal(findScriptRenameSource(documentWithRunPair, "/tmp/proj/other.py"), undefined);
});

test("test_applyRenameBadgeLabels_uses_the_basename_when_unique", () => {
    const entries: FileSidebarEntry[] = [
        { target: "/p/b.py", revisionCount: 1, isDeleted: false, originalPath: "/p/a/x.py", renameBadgeLabel: undefined },
    ];
    applyRenameBadgeLabels(entries);
    assert.equal(entries[0]?.renameBadgeLabel, "x.py");
});
