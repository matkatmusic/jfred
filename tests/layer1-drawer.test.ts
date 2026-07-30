// Tasks 257.5/294/329: node clicks fill the drawer with DiffView panes fed by string revision sources.
//
// The stage is built by hand (tests/layer1-tick-files.test.ts precedent): the contract is the DOM layer1-page.ts renders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView, rememberNavTargets } from "../webapp/layer1-diff-wash.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { openDiskNodeForPath } from "../webapp/layer1-filenav.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { setupLayer1Dom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const DISK_FILE_PATH = "src/demo.ts";
const DISK_FILE_CONTENT = "const x = 1;\nconst y = 2;\n";
const COMMIT_CONTENT = "const x = 1;\n";
const FULL_DIFF = "@@ -1,2 +1,2 @@\n const x = 1;\n const y = 2;";

// happy-dom has no animation clock, so the deferred re-centre callback runs inline; it must merely not throw.
function stubAnimationFrame(): void {
    Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
    } });
}

// Records every ask; content GETs answer via `contentFor`, the diff POST answers FULL_DIFF.
function stubRecordingFetch(contentFor: (params: URLSearchParams) => object): { url: string; body?: string }[] {
    const asks: { url: string; body?: string }[] = [];
    Object.assign(globalThis, {
        fetch: async (url: unknown, init?: { body?: string }): Promise<Response> => {
            asks.push({ url: String(url), body: init?.body });
            const payload = String(url).includes("layer1-diff-content")
                ? { diff: FULL_DIFF }
                : contentFor(new URLSearchParams(String(url).slice(String(url).indexOf("?") + 1)));
            return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
        },
    });
    return asks;
}

// The awaited chain is loadContent -> diff POST -> render; two drained turns cover it.
async function settlePendingFetches(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function firstPane(): HTMLElement {
    return getRequiredElementById("dbody").querySelector("details.dfile") as HTMLElement;
}

function paneArrows(): HTMLButtonElement[] {
    return [...firstPane().querySelectorAll("summary .dtools button")] as HTMLButtonElement[];
}

// One bubble with a single on-disk node — reads the working tree, so no commit hash needed.
function buildDiskNodeStage(): HTMLElement {
    const node = el("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
        el("div", { class: "lane" }, [node, el("span", { class: "nlabel", text: "on disk" })]),
    ]));
    return node;
}

test("clicking an on-disk node opens one DiffView pane showing the whole file, controls hidden", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asks = stubRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const node = buildDiskNodeStage();
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — Current on-disk state");
    const pane = firstPane();
    // The drawer header (asserted above) is the ONLY place a lone file is named.
    assert.equal(pane.querySelector(".dfile-path"), null);
    // Equal sides read as ONE revision, so the label names it once.
    assert.equal(pane.querySelector(".dpair")?.textContent, "on disk");
    // A lone revision has nothing to step, diff, or widen: arrows hidden, tools row not in the DOM.
    assert.ok(paneArrows().every((arrow) => arrow.hidden));
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
    setupLayer1Dom();
    stubAnimationFrame();
    stubFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT }, "/api/layer1-diff-content": { diff: FULL_DIFF } });
    buildDiskNodeStage();
    wireNodeDrawer();

    getRequiredElementById("stage").querySelector(".fname")!
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    assert.equal(getRequiredElementById("drawer").classList.contains("open"), false);
});

test("an image node renders an img off the binary route instead of fetching text", async () => {
    // Task 299: no JSON fetch happens — the img's src IS the request.
    setupLayer1Dom();
    stubAnimationFrame();
    stubFetchRoutes({});
    const node = el("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "logo.png", "data-path": "assets/logo.png" }),
        el("div", { class: "lane" }, [node, el("span", { class: "nlabel", text: "on disk" })]),
    ]));
    getInputById("dir").value = "/project";
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    const image = getRequiredElementById("dbody").querySelector("img");
    assert.ok(image?.getAttribute("src")?.includes("binary=1"), image?.outerHTML);
    assert.equal(getRequiredElementById("imgtools").hidden, false);
});

const COMMIT_HASH = "5636d8ecb1a24f0e9c7d3a1b8e5f402716c9d8aa";
const MARKDOWN_PATH = "archive/interim-run-scenario/skill/SKILL.md";

// A commit bubble: the dot's title carries the FULL hash the drawer reads (buildPairWidget's shape).
function buildCommitNodeStage(hashTitle: string): HTMLElement {
    const node = el("i", { class: "node n-commit", title: hashTitle });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "SKILL.md", "data-path": MARKDOWN_PATH }),
        el("div", { class: "lane" }, [node, el("span", { class: "nlabel", text: hashTitle.slice(0, 8), title: hashTitle })]),
    ]));
    return node;
}

test("a commit node loads its string through git's blob at its own hash", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asks = stubRecordingFetch(() => ({ content: COMMIT_CONTENT }));
    getInputById("repo").value = "/repo";
    const node = buildCommitNodeStage(COMMIT_HASH);
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    const ask = asks.find((entry) => entry.url.includes("layer1-file"))!;
    const params = new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1));
    assert.equal(params.get("hash"), COMMIT_HASH);
    assert.equal(params.get("repo"), "/repo");
    assert.equal(params.get("path"), MARKDOWN_PATH);
    assert.equal(params.has("dir"), false);
    assert.equal(getRequiredElementById("dpath").textContent, "SKILL.md — at commit 5636d8ec");
});

const LANE_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const MIDDLE_HASH = "b2c3d4e5f60718293a4b5c6d7e8f9012345678aa";

// A lane holding commit node(s) and the on-disk node, axis-placed oldest to newest.
function buildLaneStage(withMiddle: boolean): { commitNode: HTMLElement; middleNode: HTMLElement; diskNode: HTMLElement } {
    const commitNode = el("i", { class: "node n-commit", title: LANE_HASH });
    commitNode.style.setProperty("--axis-px", "10");
    const middleNode = el("i", { class: "node n-commit", title: MIDDLE_HASH });
    middleNode.style.setProperty("--axis-px", "25");
    const diskNode = el("i", { class: "node n-disk" });
    diskNode.style.setProperty("--axis-px", "40");
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
        el("div", { class: "lane" }, withMiddle ? [commitNode, middleNode, diskNode] : [commitNode, diskNode]),
    ]));
    return { commitNode, middleNode, diskNode };
}

const LANE_T0 = "2026-07-01T10:00:00.000Z";
const LANE_T1 = "2026-07-01T11:00:00.000Z";
const LANE_T2 = "2026-07-01T12:00:00.000Z";

// Task 329: the shift-click gesture reads instants off the DRAWN view, so tests arm the memo the page keeps.
function armLaneView(withMiddle: boolean): void {
    const middleTicks = withMiddle ? [{ instant: LANE_T1, axisPx: 25, eventCount: 1 }] : [];
    rememberDrawnView({
        pairs: [{
            path: DISK_FILE_PATH,
            commits: [
                { hash: LANE_HASH, instant: LANE_T0, axisPx: 10 },
                ...(withMiddle ? [{ hash: MIDDLE_HASH, instant: LANE_T1, axisPx: 25 }] : []),
            ],
            onDisk: { instant: LANE_T2, axisPx: 40 },
        }],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ instant: LANE_T0, axisPx: 10, eventCount: 1 }, ...middleTicks, { instant: LANE_T2, axisPx: 40, eventCount: 1 }],
    } as WireLayer1View);
    rememberNavTargets([]);
}

test("shift-clicking a second node diffs the two sides' STRINGS, older side as base", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asks = stubRecordingFetch((params) => ({ content: params.has("hash") ? COMMIT_CONTENT : DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    getInputById("repo").value = "/repo";
    const { commitNode, diskNode } = buildLaneStage(false);
    armLaneView(false);
    wireNodeDrawer();

    diskNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();
    commitNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settlePendingFetches();

    const posted = JSON.parse(asks.filter((ask) => ask.url.includes("layer1-diff-content")).at(-1)!.body!) as
        { base: string; target: string; context?: string };
    // The commit's instant is earlier, so its string is the base; no context until toggled.
    assert.deepEqual(posted, { base: COMMIT_CONTENT, target: DISK_FILE_CONTENT });
    assert.ok(commitNode.classList.contains("diff-base"));
    assert.ok(diskNode.classList.contains("diff-target"));
    // Task 329: the pair is a RANGE now — the header says so and the wash spans it.
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — range diff");
    assert.ok(getRequiredElementById("washes").querySelector(".diff-wash"));
    assert.equal(firstPane().querySelector(".dpair")?.textContent, "a1b2c3d4 - on disk");
    assert.ok(paneArrows().every((arrow) => !arrow.hidden));
    assert.equal(getRequiredElementById("dprev").hidden, true);
});

test("task 329: a shift-click spanning two bubbles becomes a global range diffing both files", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asks = stubRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    const firstNode = el("i", { class: "node n-disk" });
    const otherNode = el("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
            el("div", { class: "lane" }, [firstNode]),
        ]),
        el("div", { class: "filebox" }, [
            el("div", { class: "fname", text: "other.ts", "data-path": "src/other.ts" }),
            el("div", { class: "lane" }, [otherNode]),
        ]),
    );
    rememberDrawnView({
        pairs: [
            { path: DISK_FILE_PATH, commits: [], onDisk: { instant: LANE_T0, axisPx: 10 } },
            { path: "src/other.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 } },
        ],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ instant: LANE_T0, axisPx: 10, eventCount: 1 }, { instant: LANE_T2, axisPx: 40, eventCount: 1 }],
    } as WireLayer1View);
    rememberNavTargets([]);
    wireNodeDrawer();

    firstNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();
    const diffsBefore = asks.filter((ask) => ask.url.includes("layer1-diff-content")).length;
    otherNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settlePendingFetches();

    // One section per file, each posting its own diff; no refusal toast anywhere.
    assert.equal(asks.filter((ask) => ask.url.includes("layer1-diff-content")).length, diffsBefore + 2);
    assert.equal(getRequiredElementById("dbody").querySelectorAll("details.dfile").length, 2);
    assert.equal(getRequiredElementById("dpath").textContent, "2 files — range diff");
    assert.ok(getRequiredElementById("washes").querySelector(".diff-wash"));
    assert.equal(getRequiredElementById("dtoast").hidden, true);
});

const SNAPSHOT_SESSION_FILE = "/Users/me/.claude/projects/-demo/b21d84c5.jsonl";
const SNAPSHOT_SESSION_ID = "b21d84c5-0000-0000-0000-000000000001";
const SNAPSHOT_PATH = "src/util.ts";

test("clicking a snapshot node reads the owning session and sets the range-correct title", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asks = stubRecordingFetch(() => ({ content: COMMIT_CONTENT, title: "Second title" }));
    getInputById("dir").value = "/work";
    const node = el("i", { class: "node n-snap", "data-version": "2",
        "data-session-id": SNAPSHOT_SESSION_ID, "data-session-file": SNAPSHOT_SESSION_FILE, "data-line": "300" });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "util.ts", "data-path": SNAPSHOT_PATH }),
        el("div", { class: "lane" }, [node, el("span", { class: "nlabel n-snap", text: "@v2 📸" })]),
    ]));
    getRequiredElementById("sessions").replaceChildren(
        el("div", { class: "session-item", "data-file": "b21d84c5.jsonl" }),
    );
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    const ask = asks.find((entry) => entry.url.includes("snapshotSession"))!;
    const params = new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1));
    assert.equal(params.get("snapshotSession"), SNAPSHOT_SESSION_FILE);
    assert.equal(params.get("sessionId"), SNAPSHOT_SESSION_ID);
    assert.equal(params.get("version"), "2");
    assert.equal(params.get("dir"), "/work");
    assert.equal(firstPane().querySelector(".dpair")?.textContent, "@v2 📸");
    assert.equal(getRequiredElementById("dpath").textContent, "util.ts Snapshot - Second title");
    assert.ok(getRequiredElementById("sessions").querySelector(".flash-lead"));
});

test("a commit node with no hash on it falls back to the working tree, never to `git show :path`", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asks = stubRecordingFetch(() => ({ content: COMMIT_CONTENT }));
    getInputById("dir").value = "/project";
    const node = buildCommitNodeStage("");
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    const ask = asks.find((entry) => entry.url.includes("layer1-file"))!;
    const params = new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1));
    assert.equal(params.get("dir"), "/project");
    assert.equal(params.has("hash"), false);
});

test("task 325: a File Nav leaf click selects the on-disk node and opens the drawer", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    stubFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT }, "/api/layer1-diff-content": { diff: FULL_DIFF } });
    const node = buildDiskNodeStage();
    wireNodeDrawer();

    openDiskNodeForPath(DISK_FILE_PATH);
    await settlePendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — Current on-disk state");
    assert.ok(node.classList.contains("found"));
});

test("task 324/329: the pane's base arrow steps freely and equal sides read as one revision", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    stubRecordingFetch((params) => ({ content: params.has("hash") ? COMMIT_CONTENT : DISK_FILE_CONTENT }));
    getInputById("dir").value = "/project";
    getInputById("repo").value = "/repo";
    const { commitNode, middleNode, diskNode } = buildLaneStage(true);
    armLaneView(true);
    wireNodeDrawer();

    diskNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();
    commitNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settlePendingFetches();
    paneArrows()[1]!.click();
    await settlePendingFetches();

    // Task 329: rings mark the WASH boundary nodes, so an arrow step moves the pane, never the rings.
    assert.equal(firstPane().querySelector(".dpair")?.textContent, "b2c3d4e5 - on disk");
    assert.ok(commitNode.classList.contains("diff-base"));
    assert.equal(middleNode.classList.contains("diff-base"), false);
    assert.ok(diskNode.classList.contains("diff-target"));
    // Differing sides ARE a diff, so the mode/full/export tools row is visible.
    assert.equal(firstPane().querySelector<HTMLElement>("div.dhead")!.style.display, "");
    // Stepping onto the target is ALLOWED (task 329): equal sides become the full-content view.
    paneArrows()[1]!.click();
    await settlePendingFetches();
    assert.equal(firstPane().querySelector(".dpair")?.textContent, "on disk");
    // Equal sides show ONE revision: the tools row is gone until the sides split again.
    assert.equal(firstPane().querySelector<HTMLElement>("div.dhead")!.style.display, "none");
    // ...and the base→target meta says nothing; the pair label already names the revision.
    assert.equal(firstPane().querySelector(".dmeta")?.textContent, "");
    // Only the ladder's ends disable an arrow now.
    assert.equal(paneArrows()[1]!.disabled, true);
    assert.equal(paneArrows()[0]!.disabled, false);
});
