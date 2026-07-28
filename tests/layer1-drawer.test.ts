// Task 257.5 + task 294: clicking a node opens the Detail View drawer on that node's bytes, and
// those bytes are rendered by layer1-file-view.ts — numbered column plus highlighted code.
//
// The stage is built by hand rather than through the page, the precedent
// tests/layer1-tick-files.test.ts sets: the contract the drawer reads is the DOM layer1-page.ts
// renders (`.filebox` > `.fname[data-path]`, a `.lane` holding `.node` + `.nlabel`), and building
// it directly is what makes a one-node bubble three lines instead of a whole fetched view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { setupLayer1Dom, stubFetchRoutes } from "./webapp-dom-test-helpers.ts";

const DISK_FILE_PATH = "src/demo.ts";
const DISK_FILE_CONTENT = "const x = 1;\nconst y = 2;\n";

// setupLayer1Dom publishes happy-dom's document but not its animation clock, and the drawer defers
// its re-centre onto one — so the callback is run inline here. Nothing it does (scrollIntoView, the
// minimap redraw) is measurable without layout, which happy-dom has none of; running it at all is
// what proves the drawer does not throw on the way to the fetch.
function stubAnimationFrame(): void {
    Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
    } });
}

// One pair bubble carrying a single on-disk node — the kind that reads the working tree, so the
// stubbed route needs no commit hash.
function buildDiskNodeStage(): HTMLElement {
    const node = el("i", { class: "node n-disk" });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
        el("div", { class: "lane" }, [node, el("span", { class: "nlabel", text: "on disk" })]),
    ]));
    return node;
}

// The drawer's fetch is awaited inside the click handler, so the assertions have to run after the
// microtask queue drains — one turn of the event loop is enough for a stubbed, synchronous route.
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
    // Task 294's shape: two lines counted, the file's text in the code column, the trailing
    // newline NOT numbered as a third row.
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

const COMMIT_HASH = "5636d8ecb1a24f0e9c7d3a1b8e5f402716c9d8aa";
const MARKDOWN_PATH = "archive/interim-run-scenario/skill/SKILL.md";

// A commit bubble: the dot carries the FULL hash on its title, which is what the drawer reads to
// build `git show <hash>:<path>`. buildPairWidget puts it on the dot and its label alike.
function buildCommitNodeStage(hashTitle: string): HTMLElement {
    const node = el("i", { class: "node n-commit", title: hashTitle });
    getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
        el("div", { class: "fname", text: "SKILL.md", "data-path": MARKDOWN_PATH }),
        el("div", { class: "lane" }, [node, el("span", { class: "nlabel", text: hashTitle.slice(0, 8), title: hashTitle })]),
    ]));
    return node;
}

test("a commit node asks git for the blob at its own hash", async () => {
    // User, 2026-07-27: the drawer read the hash off the LABEL-only title, saw "", and asked for
    // `git show :<path>` — which the route reads as the on-disk form and refuses for a missing
    // `dir`. The reported error named the wrong parameter entirely, so this pins the URL.
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
