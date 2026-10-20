// Shift-click range diffs and pane-arrow stepping; the stage is built by hand, matching layer1-page.ts's DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
    COMMIT_CONTENT, DISK_FILE_CONTENT, applyLaneView, buildLaneStage, getFirstPane, installAnimationFrameStub,
    installRecordingFetch, listPaneArrows, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

test("shift-clicking a second node diffs the two sides' STRINGS, older side as base", async () => {
    setupLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch((params) => ({ content: params.has("hash") ? COMMIT_CONTENT : DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    getInputById("repo").value = "/repo";
    const { commitNode, diskNode } = buildLaneStage(false);
    applyLaneView(false);
    wireNodeDrawer();

    diskNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    commitNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await waitForPendingFetches();

    const posted = JSON.parse(asks.filter((ask) => ask.url.includes("layer1-diff-content")).at(-1)!.body!) as
        { base: string; target: string; context?: string };
    // The commit's instant is earlier, so its string is the base; no context until toggled.
    assert.deepEqual(posted, { base: COMMIT_CONTENT, target: DISK_FILE_CONTENT });
    assert.ok(commitNode.classList.contains("diff-base"));
    assert.ok(diskNode.classList.contains("diff-target"));
    // Task 329: the pair is a RANGE now — the header says so and the wash spans it.
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — range diff");
    assert.ok(getRequiredElementById("washes").querySelector(".diff-wash"));
    assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "a1b2c3d4 - on disk");
    assert.ok(listPaneArrows().every((arrow) => !arrow.hidden));
    assert.equal(getRequiredElementById("dprev").hidden, true);
});

test("task 324/329: the pane's base arrow steps freely and equal sides read as one revision", async () => {
    setupLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch((params) => ({ content: params.has("hash") ? COMMIT_CONTENT : DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    getInputById("repo").value = "/repo";
    const { commitNode, middleNode, diskNode } = buildLaneStage(true);
    applyLaneView(true);
    wireNodeDrawer();

    diskNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    commitNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await waitForPendingFetches();
    listPaneArrows()[1]!.click();
    await waitForPendingFetches();

    // Task 329: rings mark the WASH boundary nodes, so an arrow step moves the pane, never the rings.
    assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "b2c3d4e5 - on disk");
    assert.ok(commitNode.classList.contains("diff-base"));
    assert.equal(middleNode.classList.contains("diff-base"), false);
    assert.ok(diskNode.classList.contains("diff-target"));
    // Differing sides ARE a diff, so the mode/full/export tools row is visible.
    assert.equal(getFirstPane().querySelector<HTMLElement>("div.dhead")!.style.display, "");
    // Stepping onto the target is ALLOWED (task 329): equal sides become the full-content view.
    listPaneArrows()[1]!.click();
    await waitForPendingFetches();
    assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "on disk");
    // Equal sides show ONE revision: the tools row is gone until the sides split again.
    assert.equal(getFirstPane().querySelector<HTMLElement>("div.dhead")!.style.display, "none");
    // ...and the base→target meta says nothing; the pair label already names the revision.
    assert.equal(getFirstPane().querySelector(".dmeta")?.textContent, "");
    // Only the ladder's ends disable an arrow now.
    assert.equal(listPaneArrows()[1]!.disabled, true);
    assert.equal(listPaneArrows()[0]!.disabled, false);
});
