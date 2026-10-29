// Snapshot node clicks read the owning session and reveal raw transcript JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
    COMMIT_CONTENT, getFirstPane, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

const SNAPSHOT_SESSION_FILE = "/Users/me/.claude/projects/-demo/b21d84c5.jsonl";
const SNAPSHOT_SESSION_ID = "b21d84c5-0000-0000-0000-000000000001";
const SNAPSHOT_PATH = "src/util.ts";

test("clicking a snapshot node reads the owning session and sets the range-correct title", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ content: COMMIT_CONTENT, title: "Second title" }));
    getInputById("dir").value = "/work";
    const node = createElement("i", { class: "node n-snap", "data-version": "2",
        "data-session-id": SNAPSHOT_SESSION_ID, "data-session-file": SNAPSHOT_SESSION_FILE, "data-line": "300" });
    getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", text: "util.ts", "data-path": SNAPSHOT_PATH }),
        createElement("div", { class: "lane" }, [node, createElement("span", { class: "nlabel n-snap", text: "@v2 📸" })]),
    ]));
    getRequiredElementById("sessions").replaceChildren(
        createElement("div", { class: "session-item", "data-file": "b21d84c5.jsonl" }),
    );
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    const ask = asks.find((entry) => entry.url.includes("snapshotSession"))!;
    const params = new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1));
    assert.equal(params.get("snapshotSession"), SNAPSHOT_SESSION_FILE);
    assert.equal(params.get("sessionId"), SNAPSHOT_SESSION_ID);
    assert.equal(params.get("version"), "2");
    assert.equal(params.get("dir"), "/work");
    assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "@v2 📸");
    assert.equal(getRequiredElementById("dpath").textContent, "util.ts Snapshot - Second title");
    assert.ok(getRequiredElementById("sessions").querySelector(".flash-lead"));
});

test("task 213: a snapshot node reveals a [{ }] button that toggles its raw transcript JSON", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const rawRecord = { type: "user", uuid: SNAPSHOT_SESSION_ID, message: { content: "hello raw json" } };
    installRecordingFetch((params) => (params.has("line") ? rawRecord : { content: COMMIT_CONTENT, title: "Second title" }));
    getInputById("dir").value = "/work";
    const node = createElement("i", { class: "node n-snap", "data-version": "2",
        "data-session-id": SNAPSHOT_SESSION_ID, "data-session-file": SNAPSHOT_SESSION_FILE, "data-line": "300" });
    getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", text: "util.ts", "data-path": SNAPSHOT_PATH }),
        createElement("div", { class: "lane" }, [node, createElement("span", { class: "nlabel n-snap", text: "@v2 📸" })]),
    ]));
    getRequiredElementById("sessions").replaceChildren(
        createElement("div", { class: "session-item", "data-file": "b21d84c5.jsonl" }),
    );
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    // Step: the reveal button is present and its JSON body starts hidden.
    const toggle = getRequiredElementById("dbody").querySelector(".json-toggle") as HTMLButtonElement;
    assert.ok(toggle, "a snapshot node should get a [{ }] button");
    const jsonBox = getRequiredElementById("dbody").querySelector(".node-json") as HTMLElement;
    assert.equal(jsonBox.hidden, true);
    // Step: clicking the button reveals the highlighted-JSON pre carrying the record text.
    toggle.click();
    await waitForPendingFetches();
    assert.equal(jsonBox.hidden, false);
    assert.ok(jsonBox.querySelector("pre.inspector-json"));
    assert.ok(jsonBox.textContent?.includes("hello raw json"));
    // Step: clicking the button again hides the JSON body.
    toggle.click();
    assert.equal(jsonBox.hidden, true);
});

test("a snapshot node whose backup file is missing still reveals its raw JSON, and the pane keeps the backup error", async () => {
    initLayer1Dom();
    installAnimationFrameStub();
    const asks: string[] = [];
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            asks.push(String(url));
            const isRecordAsk = String(url).includes("layer1-record");
            return {
                ok: isRecordAsk, status: isRecordAsk ? 200 : 400,
                json: async () => ({ type: "file-history-snapshot", note: "line 437 record" }),
                text: async () => "ENOENT: no such backup file",
            } as unknown as Response;
        },
    });
    getInputById("dir").value = "/work";
    const node = createElement("i", { class: "node n-snap", "data-version": "1",
        "data-session-id": SNAPSHOT_SESSION_ID, "data-session-file": SNAPSHOT_SESSION_FILE, "data-line": "437" });
    getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", text: "plugin.json", "data-path": SNAPSHOT_PATH }),
        createElement("div", { class: "lane" }, [node]),
    ]));
    getRequiredElementById("sessions").replaceChildren(
        createElement("div", { class: "session-item", "data-file": "b21d84c5.jsonl" }),
    );
    installNodeDrawer();

    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();

    assert.ok(getFirstPane().textContent?.includes("ENOENT: no such backup file"));
    const toggle = getRequiredElementById("dbody").querySelector(".json-toggle") as HTMLButtonElement;
    assert.ok(toggle, "the button must not depend on the backup read");
    toggle.click();
    await waitForPendingFetches();
    const recordAsk = new URLSearchParams(asks.find((url) => url.includes("layer1-record"))!.split("?")[1]);
    assert.equal(recordAsk.get("jsonl"), SNAPSHOT_SESSION_FILE);
    assert.equal(recordAsk.get("line"), "437");
    assert.ok(getRequiredElementById("dbody").querySelector(".node-json")?.textContent?.includes("line 437 record"));
});
