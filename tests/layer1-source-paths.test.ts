// Tasks 295/296: the two source lists and the defaults a project folder implies.
//
// The `touched` rule is the whole point of this file: a list the user has committed must survive a
// re-derive, and a list they have not must follow the project folder. Getting that backwards either
// silently discards their picks or pins them to a stale project.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { setupLayer1Dom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const PROJECTS_DIR = "/Users/you/.claude/projects";
const FILE_HISTORY_DIR = "/Users/you/.claude/file-history";
// A space and a dot in the path, because Claude Code replaces EVERY non-alphanumeric character —
// a "/"-only rule passes on a tidy path and then names a folder that does not exist on a real one.
const PROJECT_FOLDER = "/Users/you/claude code src/demo.app";
const DERIVED_JSONL_DIR = `${PROJECTS_DIR}/-Users-you-claude-code-src-demo-app`;

// A fresh module instance per test: the lists are module state, so a previous test's `touched` flag
// would otherwise decide this one's outcome.
async function openPageWithSeededDefaults() {
    setupLayer1Dom();
    stubFetchRoutes({ "/api/config": { projectsDir: PROJECTS_DIR, fileHistoryDir: FILE_HISTORY_DIR } });
    const sourcePaths = await import(`../webapp/layer1-source-paths.ts?case=${Math.random()}`);
    await sourcePaths.seedSourceDefaults();
    getInputById("dir").value = PROJECT_FOLDER;
    return sourcePaths;
}

test("an untouched list is derived from the project folder and counted on its button", async () => {
    const sourcePaths = await openPageWithSeededDefaults();
    sourcePaths.syncSourceButtons();
    assert.deepEqual([...sourcePaths.readSourcePaths(sourcePaths.SourceKind.jsonl)], [DERIVED_JSONL_DIR]);
    assert.deepEqual([...sourcePaths.readSourcePaths(sourcePaths.SourceKind.fileHistory)], [FILE_HISTORY_DIR]);
    assert.equal(getRequiredElementById("pick-jsonl").textContent, "JSONL sources (1)");
    assert.equal(getRequiredElementById("pick-fh").textContent, "File History Snapshots (1)");
});

test("a committed list survives a re-derive", async () => {
    const sourcePaths = await openPageWithSeededDefaults();
    sourcePaths.writeSourcePaths(sourcePaths.SourceKind.jsonl, ["/elsewhere/projects"]);
    // A new project folder would re-derive an UNTOUCHED list; this one has been chosen.
    getInputById("dir").value = "/Users/you/code/other-app";
    sourcePaths.syncSourceButtons();
    assert.deepEqual([...sourcePaths.readSourcePaths(sourcePaths.SourceKind.jsonl)], ["/elsewhere/projects"]);
});

test("committing the same list again reports no change", async () => {
    const sourcePaths = await openPageWithSeededDefaults();
    assert.equal(sourcePaths.writeSourcePaths(sourcePaths.SourceKind.fileHistory, ["/a", "/b"]), true);
    assert.equal(sourcePaths.writeSourcePaths(sourcePaths.SourceKind.fileHistory, ["/a", "/b"]), false);
    assert.equal(sourcePaths.writeSourcePaths(sourcePaths.SourceKind.fileHistory, ["/b", "/a"]), true);
});
