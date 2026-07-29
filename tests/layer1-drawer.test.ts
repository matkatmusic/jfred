// Tasks 257.5 + 294: clicking a node opens the drawer on that node's bytes via layer1-file-view.ts.
//
// The stage is built by hand (tests/layer1-tick-files.test.ts precedent): the contract is the DOM layer1-page.ts renders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { openDiskNodeForPath } from "../webapp/layer1-filenav.ts";
import { setupLayer1Dom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const DISK_FILE_PATH = "src/demo.ts";
const DISK_FILE_CONTENT = "const x = 1;\nconst y = 2;\n";

// happy-dom has no animation clock, so the deferred re-centre callback runs inline; it must merely not throw.
function stubAnimationFrame(): void {
    Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
    } });
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

// Assertions run after the microtask queue drains; one event-loop turn suffices for a stubbed route.
async function settlePendingFetches(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test("clicking an on-disk node opens the drawer on that file's bytes", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    stubFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT } });
    const node = buildDiskNodeStage();
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — Current on-disk state");
    // Task 294's shape: two numbered lines; the trailing newline is not a third row.
    const body = getRequiredElementById("dbody");
    assert.equal(body.querySelector(".dgutter")?.textContent, "1\n2");
    assert.equal(body.querySelector(".dcode")?.textContent, "const x = 1;\nconst y = 2;");
});

test("a click on anything that is not a node leaves the drawer shut", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    stubFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT } });
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
    assert.ok(image?.getAttribute("src")?.includes("logo.png"));
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

test("a commit node asks git for the blob at its own hash", async () => {
    // User, 2026-07-27: a label-only title once built `git show :<path>`, erroring on the wrong parameter; this pins the URL.
    setupLayer1Dom();
    stubAnimationFrame();
    let asked = "";
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            asked = String(url);
            return { ok: true, status: 200, json: async () => ({ content: "# Title\n\ntext\n" }), text: async () => "" } as unknown as Response;
        },
    });
    getInputById("repo").value = "/repo";
    const node = buildCommitNodeStage(COMMIT_HASH);
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    const params = new URLSearchParams(asked.slice(asked.indexOf("?") + 1));
    assert.equal(params.get("hash"), COMMIT_HASH);
    assert.equal(params.get("repo"), "/repo");
    assert.equal(params.get("path"), MARKDOWN_PATH);
    assert.equal(params.has("dir"), false);
    assert.equal(getRequiredElementById("dpath").textContent, "SKILL.md — at commit 5636d8ec");
    // The markdown renders as text rather than being refused.
    assert.equal(getRequiredElementById("dbody").querySelector(".dgutter")?.textContent, "1\n2\n3");
});

const LANE_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

// One bubble whose lane holds a commit node (earlier) and the on-disk node (later), axis-placed.
function buildTwoNodeStage(): { commitNode: HTMLElement; diskNode: HTMLElement } {
    const commitNode = el("i", { class: "node n-commit", title: LANE_HASH });
    commitNode.style.setProperty("--axis-px", "10");
    const diskNode = el("i", { class: "node n-disk" });
    diskNode.style.setProperty("--axis-px", "40");
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
        el("div", { class: "lane" }, [commitNode, diskNode]),
    ]));
    return { commitNode, diskNode };
}

test("shift-clicking a second node on the same lane asks the diff route, older side as base", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asked: string[] = [];
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            asked.push(String(url));
            const payload = String(url).includes("layer1-diff")
                ? { diff: "@@ -1 +1,2 @@\n shared\n+added line" }
                : { content: DISK_FILE_CONTENT };
            return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
        },
    });
    getInputById("dir").value = "/project";
    getInputById("repo").value = "/repo";
    const { commitNode, diskNode } = buildTwoNodeStage();
    wireNodeDrawer();

    diskNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();
    commitNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settlePendingFetches();

    const diffAsk = asked.find((url) => url.includes("layer1-diff"))!;
    const params = new URLSearchParams(diffAsk.slice(diffAsk.indexOf("?") + 1));
    // The commit sits earlier on the axis, so it is the base; the disk side sends no targetHash.
    assert.equal(params.get("baseHash"), LANE_HASH);
    assert.equal(params.has("targetHash"), false);
    assert.equal(params.get("dir"), "/project");
    assert.equal(params.get("repo"), "/repo");
    assert.ok(commitNode.classList.contains("diff-base"));
    assert.ok(diskNode.classList.contains("diff-target"));
    // Task 324's header split: the name stays in dpath, the pair rides the label between the arrow pairs.
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts");
    assert.equal(getRequiredElementById("dpairlabel").textContent, "a1b2c3d4 - on disk");
    // The default side-by-side render: the classic grid with numbered gutter cells and an add wash.
    const body = getRequiredElementById("dbody");
    assert.ok(body.querySelector(".diff-cols"), body.innerHTML);
    assert.ok(body.querySelector(".dc-body.dc-add"), body.innerHTML);
    assert.equal(getRequiredElementById("difftools").hidden, false);
});

test("a shift-click spanning two bubbles is refused with a visible toast, never diffed", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asked: string[] = [];
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            asked.push(String(url));
            return { ok: true, status: 200, json: async () => ({ content: DISK_FILE_CONTENT }), text: async () => "" } as unknown as Response;
        },
    });
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
    wireNodeDrawer();

    firstNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();
    otherNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settlePendingFetches();

    assert.equal(asked.some((url) => url.includes("layer1-diff")), false);
    const toast = getRequiredElementById("dtoast");
    assert.equal(toast.hidden, false);
    assert.ok(toast.textContent?.includes("ONE bubble"), toast.textContent ?? "");
});

test("a commit node with no hash on it falls back to the working tree, never to `git show :path`", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    let asked = "";
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            asked = String(url);
            return { ok: true, status: 200, json: async () => ({ content: "x\n" }), text: async () => "" } as unknown as Response;
        },
    });
    getInputById("dir").value = "/project";
    const node = buildCommitNodeStage("");
    wireNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();

    const params = new URLSearchParams(asked.slice(asked.indexOf("?") + 1));
    assert.equal(params.get("dir"), "/project");
    assert.equal(params.has("hash"), false);
});

test("task 325: a File Nav leaf click selects the on-disk node and opens the drawer", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    stubFetchRoutes({ "/api/layer1-file": { content: DISK_FILE_CONTENT } });
    const node = buildDiskNodeStage();
    wireNodeDrawer();

    openDiskNodeForPath(DISK_FILE_PATH);
    await settlePendingFetches();

    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "demo.ts — Current on-disk state");
    assert.ok(node.classList.contains("found"));
});

const MIDDLE_HASH = "b2c3d4e5f60718293a4b5c6d7e8f9012345678aa";

// A three-node lane so a pair (first, last) leaves the middle free for arrow steps.
function buildThreeNodeStage(): { commitNode: HTMLElement; middleNode: HTMLElement; diskNode: HTMLElement } {
    const commitNode = el("i", { class: "node n-commit", title: LANE_HASH });
    commitNode.style.setProperty("--axis-px", "10");
    const middleNode = el("i", { class: "node n-commit", title: MIDDLE_HASH });
    middleNode.style.setProperty("--axis-px", "25");
    const diskNode = el("i", { class: "node n-disk" });
    diskNode.style.setProperty("--axis-px", "40");
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
        el("div", { class: "lane" }, [commitNode, middleNode, diskNode]),
    ]));
    return { commitNode, middleNode, diskNode };
}

test("task 324: the base arrow steps the base node and refuses to collide with the target", async () => {
    setupLayer1Dom();
    stubAnimationFrame();
    const asked: string[] = [];
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            asked.push(String(url));
            const payload = String(url).includes("layer1-diff")
                ? { diff: "@@ -1 +1,2 @@\n shared\n+added line" }
                : { content: DISK_FILE_CONTENT };
            return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
        },
    });
    getInputById("dir").value = "/project";
    getInputById("repo").value = "/repo";
    const { commitNode, middleNode, diskNode } = buildThreeNodeStage();
    wireNodeDrawer();

    diskNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settlePendingFetches();
    commitNode.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settlePendingFetches();
    getRequiredElementById("dbnext").click();
    await settlePendingFetches();

    const lastDiffAsk = asked.filter((url) => url.includes("layer1-diff")).at(-1)!;
    assert.equal(new URLSearchParams(lastDiffAsk.slice(lastDiffAsk.indexOf("?") + 1)).get("baseHash"), MIDDLE_HASH);
    assert.ok(middleNode.classList.contains("diff-base"));
    assert.equal(commitNode.classList.contains("diff-base"), false);
    assert.ok(diskNode.classList.contains("diff-target"));
    // The next base step would land on the target, so the arrow disables; target-prev likewise.
    assert.equal((getRequiredElementById("dbnext") as HTMLButtonElement).disabled, true);
    assert.equal((getRequiredElementById("dtprev") as HTMLButtonElement).disabled, true);
    assert.equal((getRequiredElementById("dtnext") as HTMLButtonElement).disabled, true);
    assert.equal((getRequiredElementById("dbprev") as HTMLButtonElement).disabled, false);
    // Pair mode shows the pair arrows and hides the single-node pair (task 324).
    assert.equal(getRequiredElementById("pairtools").hidden, false);
    assert.equal(getRequiredElementById("dprev").hidden, true);
});
