// Node clicks fill the drawer with DiffView panes; the stage is built by hand, matching layer1-page.ts's DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import { openDiskNodeForPath } from "../webapp/layer1-filenav.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installFetchRoutes } from "./webapp-fetch-test-helpers.ts";
import {
    COMMIT_CONTENT, DISK_FILE_CONTENT, DISK_FILE_PATH, FULL_DIFF, buildDiskNodeStage, getFirstPane,
    installAnimationFrameStub, installRecordingFetch, listPaneArrows, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

test("clicking an on-disk node opens one DiffView pane showing the whole file, controls hidden", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const node = buildDiskNodeStage();
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — Current on-disk state");
    const pane = getFirstPane();
    // The drawer header (asserted above) is the ONLY place a lone file is named.
    assert.equal(pane.querySelector(".dfile-path"), null);
    // Equal sides read as ONE revision, so the label names it once.
    assert.equal(pane.querySelector(".dpair")?.textContent, "on disk");
    // A lone revision has nothing to step, diff, or widen: arrows hidden, tools row not in the DOM.
    assert.ok(listPaneArrows().every((arrow) => arrow.hidden));
    assert.equal(pane.querySelector(".dfull-toggle"), null);
    assert.equal(pane.querySelector("button[data-mode]"), null);
    // The body renders the synthesized full-content hunk the POST answered.
    assert.equal(pane.querySelectorAll(".diff-line").length, 3);
    // diff = buildDiffFrom(base, target): both sides went up as the SAME content string, full width.
    const posted = JSON.parse(asks.find((ask) => ask.url.includes("layer1-diff-content"))!.body!) as
        { base: string; target: string; context?: string };
    assert.deepEqual(posted, { base: DISK_FILE_CONTENT, target: DISK_FILE_CONTENT, context: "full" });
});

test("a click on anything that is not a node leaves the drawer shut", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    installFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT }, "/api/layer1-diff-content": { diff: FULL_DIFF } });
    buildDiskNodeStage();
    installNodeDrawer();

    getRequiredElementById("stage").querySelector(".fname")!
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.equal(getRequiredElementById("drawer").classList.contains("open"), false);
});

const COMMIT_HASH = "5636d8ecb1a24f0e9c7d3a1b8e5f402716c9d8aa";
const MARKDOWN_PATH = "archive/interim-run-scenario/skill/SKILL.md";

// A commit bubble: the dot's title carries the FULL hash the drawer reads (buildPairWidget's shape).
function buildCommitNodeStage(hashTitle: string): HTMLElement {
    const node = createElement("i", { class: "node n-commit", title: hashTitle });
    getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", text: "SKILL.md", "data-path": MARKDOWN_PATH }),
        createElement("div", { class: "lane" }, [node, createElement("span", { class: "nlabel", text: hashTitle.slice(0, 8), title: hashTitle })]),
    ]));
    return node;
}

test("a commit node loads its string through git's blob at its own hash", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ content: COMMIT_CONTENT }));
    getInputById("repo").value = "/repo";
    const node = buildCommitNodeStage(COMMIT_HASH);
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    const ask = asks.find((entry) => entry.url.includes("layer1-file"))!;
    const params = new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1));
    assert.equal(params.get("hash"), COMMIT_HASH);
    assert.equal(params.get("repo"), "/repo");
    assert.equal(params.get("path"), MARKDOWN_PATH);
    assert.equal(params.has("dir"), false);
    assert.equal(getRequiredElementById("dpath").textContent, "SKILL.md — at commit 5636d8ec");
});

test("a commit node with no hash on it falls back to the working tree, never to `git show :path`", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ content: COMMIT_CONTENT }));
    getInputById("dir").value = "/project";
    const node = buildCommitNodeStage("");
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    const ask = asks.find((entry) => entry.url.includes("layer1-file"))!;
    const params = new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1));
    assert.equal(params.get("dir"), "/project");
    assert.equal(params.has("hash"), false);
});

test("task 325: a File Nav leaf click selects the on-disk node and opens the drawer", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    installFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT }, "/api/layer1-diff-content": { diff: FULL_DIFF } });
    const node = buildDiskNodeStage();
    installNodeDrawer();

    openDiskNodeForPath(DISK_FILE_PATH);
    await waitForPendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — Current on-disk state");
    assert.ok(node.classList.contains("found"));
});

test("task 213: a commit node shows no [{ }] button (it has no transcript line)", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: COMMIT_CONTENT }));
    getInputById("repo").value = "/repo";
    const node = buildCommitNodeStage(COMMIT_HASH);
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.equal(getRequiredElementById("dbody").querySelector(".json-toggle"), null);
});

test("task 213: an on-disk node shows no [{ }] button (it has no transcript line)", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const node = buildDiskNodeStage();
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.equal(getRequiredElementById("dbody").querySelector(".json-toggle"), null);
});
