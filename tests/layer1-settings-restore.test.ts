// Task 297: loadSavedSettings fills the page from the saved file or the config defaults, per field.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById } from "../webapp/app-dom.ts";
import { getCollapsedFoldersForProject } from "../webapp/layer1-settings.ts";
import { loadSavedSettings } from "../webapp/layer1-settings-restore.ts";
import { readSourcePaths, writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { SAVED_PROJECT, stubSettingsRoute } from "./layer1-settings-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("the saved file fills the boxes and the two source lists", async () => {
    initLayer1Dom();
    stubSettingsRoute({ lastDir: SAVED_PROJECT.dir, projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT } }, true);

    assert.equal(await loadSavedSettings(), true);

    assert.equal(getInputById("dir").value, SAVED_PROJECT.dir);
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], SAVED_PROJECT.jsonl);
    assert.deepEqual([...readSourcePaths(SourceKind.fileHistory)], SAVED_PROJECT.fileHistory);
});

test("a link wins for the fields it names, and only those", async () => {
    // Precedence is PER FIELD: a ?dir=&repo= link leaves the source lists alone.
    initLayer1Dom("?dir=/Users/you/code/other-app&repo=/Users/you/code/other-app");
    stubSettingsRoute({ lastDir: SAVED_PROJECT.dir, projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT } }, true);
    getInputById("dir").value = "/Users/you/code/other-app";

    assert.equal(await loadSavedSettings(), true);

    assert.equal(getInputById("dir").value, "/Users/you/code/other-app");
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], SAVED_PROJECT.jsonl);
});

test("a link carrying its own source list keeps it", async () => {
    initLayer1Dom("?dir=/Users/you/code/other-app&jsonl=%2Flinked%2Fprojects");
    stubSettingsRoute({ lastDir: SAVED_PROJECT.dir, projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT } }, true);
    writeSourcePaths(SourceKind.jsonl, ["/linked/projects"]);

    await loadSavedSettings();

    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], ["/linked/projects"]);
});

test("debugConfig defaults fill the page when nothing is saved", async () => {
    const DEFAULTS = { dir: "/cfg/project", repo: "/cfg/project", jsonl: ["/cfg/a", "/cfg/b", "/cfg/c"] };
    initLayer1Dom();
    stubSettingsRoute({ lastDir: null, projects: {}, defaults: DEFAULTS }, true);
    writeSourcePaths(SourceKind.jsonl, []);

    assert.equal(await loadSavedSettings(), true);

    assert.equal(getInputById("dir").value, "/cfg/project");
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], DEFAULTS.jsonl);
});

test("a saved project beats the debugConfig defaults", async () => {
    initLayer1Dom();
    stubSettingsRoute({
        lastDir: SAVED_PROJECT.dir,
        projects: { [SAVED_PROJECT.dir]: SAVED_PROJECT },
        defaults: { dir: "/cfg/project", jsonl: ["/cfg/a"] },
    }, true);

    await loadSavedSettings();

    assert.equal(getInputById("dir").value, SAVED_PROJECT.dir);
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], SAVED_PROJECT.jsonl);
});

test("restoring settings makes every saved project's collapsed folders available", async () => {
    initLayer1Dom();
    const dirA = SAVED_PROJECT.dir;
    const dirB = "/Users/you/code/other-app";
    stubSettingsRoute({
        lastDir: dirA,
        projects: {
            [dirA]: { ...SAVED_PROJECT, collapsedFolders: ["src/x"] },
            [dirB]: { ...SAVED_PROJECT, dir: dirB },
        },
    }, true);

    await loadSavedSettings();

    assert.deepEqual(getCollapsedFoldersForProject(dirA), ["src/x"]);
    assert.deepEqual(getCollapsedFoldersForProject(dirB), []);
    assert.deepEqual(getCollapsedFoldersForProject("unknown-dir"), []);
});
