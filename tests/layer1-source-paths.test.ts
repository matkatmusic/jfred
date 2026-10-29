// Tasks 295/296: a touched list survives a re-derive; an untouched list follows the project folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

const PROJECTS_DIR = "/Users/you/.claude/projects";
const FILE_HISTORY_DIR = "/Users/you/.claude/file-history";
// A space and a dot in the path: Claude Code replaces every non-alphanumeric character.
const PROJECT_FOLDER = "/Users/you/claude code src/demo.app";
const DERIVED_JSONL_DIR = `${PROJECTS_DIR}/-Users-you-claude-code-src-demo-app`;

// Fresh module per test: the lists are module state, so a prior `touched` flag would leak.
async function openPageWithSeededDefaults() {
    initLayer1Dom();
    installFetchRoutes({ "/api/config": { projectsDir: PROJECTS_DIR, fileHistoryDir: FILE_HISTORY_DIR } });
    const sourcePaths = await import(`../webapp/layer1-source-paths.ts?case=${Math.random()}`);
    await sourcePaths.loadSourceDefaults();
    getInputById("dir").value = PROJECT_FOLDER;
    return sourcePaths;
}

test("an untouched list is derived from the project folder and counted on its button", async () => {
    const sourcePaths = await openPageWithSeededDefaults();
    sourcePaths.syncSourceButtons();
    assert.deepEqual([...sourcePaths.readSourcePaths(SourceKind.jsonl)], [DERIVED_JSONL_DIR]);
    assert.deepEqual([...sourcePaths.readSourcePaths(SourceKind.fileHistory)], [FILE_HISTORY_DIR]);
    assert.equal(getRequiredElementById("pick-jsonl").textContent, "JSONL sources (1)");
    assert.equal(getRequiredElementById("pick-fh").textContent, "File History Snapshots (1)");
});

test("a committed list survives a re-derive", async () => {
    const sourcePaths = await openPageWithSeededDefaults();
    sourcePaths.writeSourcePaths(SourceKind.jsonl, ["/elsewhere/projects"]);
    // A new project folder would re-derive an UNTOUCHED list; this one has been chosen.
    getInputById("dir").value = "/Users/you/code/other-app";
    sourcePaths.syncSourceButtons();
    assert.deepEqual([...sourcePaths.readSourcePaths(SourceKind.jsonl)], ["/elsewhere/projects"]);
});

test("committing the same list again reports no change", async () => {
    const sourcePaths = await openPageWithSeededDefaults();
    assert.equal(sourcePaths.writeSourcePaths(SourceKind.fileHistory, ["/a", "/b"]), true);
    assert.equal(sourcePaths.writeSourcePaths(SourceKind.fileHistory, ["/a", "/b"]), false);
    assert.equal(sourcePaths.writeSourcePaths(SourceKind.fileHistory, ["/b", "/a"]), true);
});
