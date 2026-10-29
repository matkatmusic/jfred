// DOM smoke tests for webapp/inspector-snapshots.ts (task 122): render counter, drawer teardown, presence probe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initWebappDom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";

// Load the module AFTER the happy-dom globals exist: its imports expect browser globals.
async function importInspectorSnapshots(): Promise<typeof import("../webapp/inspector-snapshots.ts")> {
    initWebappDom();
    return import("../webapp/inspector-snapshots.ts");
}

test("test_updateShowLineRenderCount_returns_strictly_increasing_counts", async () => {
    // Scenario: every showLine render advances the counter by exactly one; the stale-render guard needs this.
    const { updateShowLineRenderCount } = await importInspectorSnapshots();
    const firstCount = updateShowLineRenderCount();
    const secondCount = updateShowLineRenderCount();
    assert.equal(secondCount, firstCount + 1);
});

test("test_buildSnapshotDrawer_close_button_removes_drawer_and_split_class", async () => {
    // Scenario: the drawer's Close button removes the drawer element and drops the pane's snapshot-drawer split modifier.
    const { buildSnapshotDrawer } = await importInspectorSnapshots();
    // a details pane currently split by the drawer.
    const pane = document.createElement("div");
    pane.classList.add("snapshot-drawer");
    const snapshotText = document.createElement("pre");
    const drawer = buildSnapshotDrawer(pane, { relativePath: "src/a.py", backupTime: undefined }, "blob-1", snapshotText);
    pane.append(drawer);
    // the header names the tracked file and the blob.
    assert.ok(drawer.textContent!.includes("src/a.py — blob-1"));
    // clicking Close detaches the drawer and clears the split modifier.
    const closeButton = drawer.querySelector("button");
    assert.ok(closeButton !== null);
    closeButton.click();
    assert.equal(drawer.parentElement, null);
    assert.equal(pane.classList.contains("snapshot-drawer"), false);
});

test("test_scanTrackedBackupPresence_records_presence_and_reshows_current_line", async () => {
    // Scenario: an unprobed backup name is fetched via /api/blob; the probe records it and re-shows the line.
    const { blobPresenceByKey, updateShowLineRenderCount, scanTrackedBackupPresence } = await importInspectorSnapshots();
    installFetchRoutes({ "/api/blob": { exists: true } });
    const shownLines: number[] = [];
    // the probing render is the current one for the whole probe lifetime.
    const renderCountAtStart = updateShowLineRenderCount();
    scanTrackedBackupPresence({ "src/a.py": { backupFileName: "blob-A" } }, "session-1", renderCountAtStart, (line) => shownLines.push(line), 7);
    await waitForAsyncWork();
    // assert the presence landed in the cache and the pane re-showed line 7 exactly once.
    assert.equal(blobPresenceByKey.get("session-1|blob-A"), true);
    assert.deepEqual(shownLines, [7]);
});

test("test_scanTrackedBackupPresence_skips_reshow_after_a_newer_render", async () => {
    // Scenario: the pane showed another line mid-probe; the probe records presence but must NOT re-show.
    const { blobPresenceByKey, updateShowLineRenderCount, scanTrackedBackupPresence } = await importInspectorSnapshots();
    installFetchRoutes({ "/api/blob": { exists: false } });
    const shownLines: number[] = [];
    // blob-B: the presence cache from the previous test must not short-circuit this probe.
    const renderCountAtStart = updateShowLineRenderCount();
    scanTrackedBackupPresence({ "src/b.py": { backupFileName: "blob-B" } }, "session-1", renderCountAtStart, (line) => shownLines.push(line), 9);
    // a newer render supersedes the probing one before the probe settles.
    updateShowLineRenderCount();
    await waitForAsyncWork();
    // assert the presence still landed but no re-show happened.
    assert.equal(blobPresenceByKey.get("session-1|blob-B"), false);
    assert.deepEqual(shownLines, []);
});
