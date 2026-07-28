// DOM smoke tests for webapp/inspector-snapshots.ts (task 122): the render counter, the snapshot drawer teardown, and the blob-presence probe's record/re-show contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupWebappDom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

// Load the module under test AFTER the happy-dom globals exist — its import chain reaches app-fetch/inspector-json, which expect the browser globals.
async function importInspectorSnapshots(): Promise<typeof import("../webapp/inspector-snapshots.ts")> {
    setupWebappDom();
    return import("../webapp/inspector-snapshots.ts");
}

test("test_bumpShowLineRenderCount_returns_strictly_increasing_counts", async () => {
    // Scenario: every showLine render advances the counter by exactly one — the probe's stale-render guard depends on this monotonic count.
    const { bumpShowLineRenderCount } = await importInspectorSnapshots();
    const firstCount = bumpShowLineRenderCount();
    const secondCount = bumpShowLineRenderCount();
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

test("test_probeTrackedBackupPresence_records_presence_and_reshows_current_line", async () => {
    // Scenario: an unprobed backup name is fetched via /api/blob; the settled probe records its presence and re-shows the SAME line because the render count is unchanged.
    const { blobPresenceByKey, bumpShowLineRenderCount, probeTrackedBackupPresence } = await importInspectorSnapshots();
    stubFetchRoutes({ "/api/blob": { exists: true } });
    const shownLines: number[] = [];
    // the probing render is the current one for the whole probe lifetime.
    const renderCountAtStart = bumpShowLineRenderCount();
    probeTrackedBackupPresence({ "src/a.py": { backupFileName: "blob-A" } }, "session-1", renderCountAtStart, (line) => shownLines.push(line), 7);
    await flushAsyncWork();
    // assert the presence landed in the cache and the pane re-showed line 7 exactly once.
    assert.equal(blobPresenceByKey.get("session-1|blob-A"), true);
    assert.deepEqual(shownLines, [7]);
});

test("test_probeTrackedBackupPresence_skips_reshow_after_a_newer_render", async () => {
    // Scenario: the pane rendered a different line while the probe was in flight — the settled probe still records presence but must NOT re-show the stale line.
    const { blobPresenceByKey, bumpShowLineRenderCount, probeTrackedBackupPresence } = await importInspectorSnapshots();
    stubFetchRoutes({ "/api/blob": { exists: false } });
    const shownLines: number[] = [];
    // blob-B: the presence cache from the previous test must not short-circuit this probe.
    const renderCountAtStart = bumpShowLineRenderCount();
    probeTrackedBackupPresence({ "src/b.py": { backupFileName: "blob-B" } }, "session-1", renderCountAtStart, (line) => shownLines.push(line), 9);
    // a newer render supersedes the probing one before the probe settles.
    bumpShowLineRenderCount();
    await flushAsyncWork();
    // assert the presence still landed but no re-show happened.
    assert.equal(blobPresenceByKey.get("session-1|blob-B"), false);
    assert.deepEqual(shownLines, []);
});
