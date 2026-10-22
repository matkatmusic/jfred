// Task 292: the JSONLs pane's selection rules and the filter targets they produce.  Pinned because "a re-click on the ONLY pick clears it" is the half that is easy to drop.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    listSelectedSessions,
    listSessionFilterTargets,
    renderSessionPane,
    resetSessionSelection,
    setKnownProjectPaths,
    wireBubbleFlash,
} from "../webapp/layer1-sessions.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { readSourcePaths, writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const PROJECT_FOLDER = "/Users/you/code/demo-app";
// Transcripts record ABSOLUTE paths; the fixture is absolute so the relative translation is exercised, not assumed.
const SESSIONS = [
    { file: "0f3c9a7e.jsonl", fullPath: "/p/0f3c9a7e.jsonl", titles: ["seed the demo app"],
        started: "2026-06-01T08:44:00Z", ended: "2026-06-01T09:12:00Z",
        paths: [`${PROJECT_FOLDER}/src/index.ts`, `${PROJECT_FOLDER}/README.md`] },
    { file: "b21d84c5.jsonl", fullPath: "/p/b21d84c5.jsonl", titles: ["extract the trim helper"],
        started: "2026-06-01T14:05:00Z", ended: "2026-06-03T18:40:00Z",
        // src/index.ts is shared with the first session, so the union has to de-duplicate it.
        paths: [`${PROJECT_FOLDER}/src/index.ts`, `${PROJECT_FOLDER}/src/util.ts`] },
    // Touched nothing this project draws: the pane must not list it at all.
    { file: "ffffffff.jsonl", fullPath: "/p/ffffffff.jsonl", titles: ["an unrelated project"],
        started: "2026-06-02T00:00:00Z", ended: "2026-06-02T01:00:00Z",
        paths: ["/Users/you/code/other-app/main.go"] },
];
// What the drawn view knows about, in the view's own relative spelling.
const KNOWN_PATHS = ["src/index.ts", "src/util.ts", "README.md"];

// The stub answers /api/layer1-sessions and the source list points somewhere; an empty list means no fetch.
async function openSessionPane(sessions: object[] = SESSIONS): Promise<void> {
    setupLayer1Dom();
    writeSourcePaths(SourceKind.jsonl, ["/p"]);
    // Task 304: the pane reads the endpoint as an NDJSON stream, so the stub answers one.
    stubStreamRoute("/api/layer1-sessions", [
        { kind: "progress", label: "scanning JSONL files", current: 1, total: 3 },
        { sessions },
    ]);
    resetSessionSelection();
    const { loadLayer1Sessions } = await import("../webapp/layer1-sessions.ts");
    await loadLayer1Sessions();
    // What the page does once a view is drawn: hand the pane the files this project knows about.
    setKnownProjectPaths(PROJECT_FOLDER, KNOWN_PATHS);
    renderSessionPane(() => {});
}

function clickSession(index: number, shiftKey: boolean = false): void {
    document.querySelectorAll(".session-item")[index]!
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey }));
}

test("a plain click picks one, and a plain re-click on the only pick clears it", async () => {
    await openSessionPane();
    assert.equal(document.querySelectorAll(".session-item").length, 2);

    clickSession(0);
    assert.deepEqual(listSelectedSessions().map((session) => session.file), ["0f3c9a7e.jsonl"]);

    clickSession(0);
    assert.deepEqual(listSelectedSessions(), []);
});

test("shift-click extends the selection", async () => {
    await openSessionPane();
    clickSession(0);
    clickSession(1, true);
    assert.deepEqual(listSelectedSessions().map((session) => session.file).sort(),
        ["0f3c9a7e.jsonl", "b21d84c5.jsonl"]);
});

test("the filter targets are the union of the picked sessions' paths, de-duplicated", async () => {
    await openSessionPane();
    assert.deepEqual(listSessionFilterTargets(), []);

    clickSession(0);
    clickSession(1, true);
    assert.deepEqual(listSessionFilterTargets().sort(), ["README.md", "src/index.ts", "src/util.ts"]);
});

test("the clear button is disabled at rest and empties the selection", async () => {
    await openSessionPane();
    const clear = document.getElementById("clear-sessions") as HTMLButtonElement;
    assert.equal(clear.disabled, true);

    clickSession(1);
    assert.equal((document.getElementById("clear-sessions") as HTMLButtonElement).disabled, false);

    document.getElementById("clear-sessions")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(listSelectedSessions(), []);
    // The pane is redrawn by the clear, so the button is read off the fresh DOM.
    assert.equal((document.getElementById("clear-sessions") as HTMLButtonElement).disabled, true);
});

test("no picked JSONL source folders means no sessions and no fetch", async () => {
    setupLayer1Dom();
    writeSourcePaths(SourceKind.jsonl, []);
    Object.assign(globalThis, { fetch: () => { throw new Error("must not fetch"); } });
    resetSessionSelection();
    const { loadLayer1Sessions } = await import("../webapp/layer1-sessions.ts");

    await loadLayer1Sessions();

    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], []);
    assert.deepEqual(listSelectedSessions(), []);
});

test("a session that touched none of this project's files is not listed", async () => {
    // User, 2026-07-27: only transcripts answerable for THIS project are listed; ffffffff.jsonl touched another tree.
    await openSessionPane();
    const listed = [...document.querySelectorAll(".session-item .sname")].map((row) => row.textContent);
    assert.deepEqual(listed, ["0f3c9a7e.jsonl", "b21d84c5.jsonl"]);
});

test("before a view is drawn every session is listed", async () => {
    // Empty known-path set = "nothing known yet": show everything, or the pane reads broken during the first build.
    await openSessionPane();
    setKnownProjectPaths(PROJECT_FOLDER, []);
    renderSessionPane(() => {});
    assert.equal(document.querySelectorAll(".session-item").length, SESSIONS.length);
});

test("a row shows one distinct title per line before its meta line, and none when unnamed", async () => {
    const touched = [`${PROJECT_FOLDER}/src/index.ts`];
    const base = { fullPath: "/p/x.jsonl", started: "2026-06-01T08:44:00Z", ended: "2026-06-01T09:12:00Z", paths: touched };
    await openSessionPane([
        { ...base, file: "named.jsonl", titles: ["first pass", "second pass", "first pass"] },
        { ...base, file: "unnamed.jsonl", titles: [] },
    ]);
    const rowKinds = (index: number): string[] =>
        [...document.querySelectorAll(".session-item")[index]!.children].map((child) => child.className);
    assert.deepEqual(rowKinds(0), ["sname", "stitle", "stitle", "smeta"]);
    assert.deepEqual([...document.querySelectorAll(".session-item")[0]!.querySelectorAll(".stitle")].map((row) => row.textContent),
        ["first pass", "second pass"]);
    assert.deepEqual(rowKinds(1), ["sname", "smeta"]);
});

const UNTITLED_SESSION = { file: "untitled.jsonl", fullPath: "/p/untitled.jsonl", titles: [],
    started: "2026-06-02T08:00:00Z", ended: "2026-06-02T09:00:00Z", paths: [`${PROJECT_FOLDER}/README.md`] };

function typeSessionSearch(text: string, onChange: () => void = () => {}): string[] {
    const box = document.getElementById("session-search") as HTMLInputElement;
    renderSessionPane(onChange);
    box.value = text;
    box.dispatchEvent(new window.Event("input"));
    return [...document.querySelectorAll<HTMLElement>(".session-item")].map((row) => row.dataset.file!);
}

test("typing a title word keeps only the matching rows, ignoring case", async () => {
    await openSessionPane([...SESSIONS, UNTITLED_SESSION]);
    assert.deepEqual(typeSessionSearch("TRIM"), ["b21d84c5.jsonl"]);
});

test("an untitled session is hidden while the search box has text", async () => {
    await openSessionPane([...SESSIONS, UNTITLED_SESSION]);
    assert.ok(typeSessionSearch("").includes("untitled.jsonl"));
    assert.ok(!typeSessionSearch("the").includes("untitled.jsonl"));
});

test("a term nothing matches leaves no rows and one no-matches line", async () => {
    await openSessionPane();
    assert.deepEqual(typeSessionSearch("zzz-no-such-title"), []);
    assert.equal(document.querySelectorAll("#sessions .navempty").length, 1);
    assert.equal(document.querySelector("#sessions .navempty")!.textContent, "no matches");
});

test("the search clear button empties the box and restores every visible row", async () => {
    await openSessionPane();
    typeSessionSearch("trim");
    document.getElementById("session-search-clear")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal((document.getElementById("session-search") as HTMLInputElement).value, "");
    assert.equal(document.querySelectorAll(".session-item").length, 2);
});

test("typing in the search box redraws the pane without calling onChange", async () => {
    await openSessionPane();
    let changeCount = 0;
    typeSessionSearch("trim", () => { changeCount += 1; });
    assert.equal(changeCount, 0);
});

// Task 308: a bubble click lights the JSONLs that touched its file; the lead is the one nearest the clicked level.
const TOP_NODE_INSTANT = "2026-06-01T08:50:00Z";
const BOTTOM_NODE_INSTANT = "2026-06-03T12:00:00Z";
const TOP_NODE_CENTER_Y = 100;
const BOTTOM_NODE_CENTER_Y = 500;

// happy-dom has no layout, so each node reports the vertical position the test gives it.
function buildNodeAt(instant: string, centerY: number): HTMLElement {
    const node = document.createElement("i");
    node.className = "node";
    node.dataset.instant = instant;
    node.getBoundingClientRect = () => new window.DOMRect(0, centerY - 10, 10, 20);
    return node;
}

function drawBubble(path: string): { name: HTMLElement; topNode: HTMLElement } {
    const box = document.createElement("div");
    box.className = "filebox";
    const name = document.createElement("span");
    name.className = "fname";
    name.dataset.path = path;
    const topNode = buildNodeAt(TOP_NODE_INSTANT, TOP_NODE_CENTER_Y);
    box.append(name, topNode, buildNodeAt(BOTTOM_NODE_INSTANT, BOTTOM_NODE_CENTER_Y));
    getRequiredElementById("stage").append(box);
    wireBubbleFlash();
    return { name, topNode };
}

function clickAt(target: HTMLElement, clientY: number): void {
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientY }));
}

function listFlashedFiles(): string[] {
    return [...document.querySelectorAll<HTMLElement>(".session-item.flash")].map((row) => row.dataset.file!).sort();
}

test("a bubble click flashes every visible session that touched the file", async () => {
    await openSessionPane();
    const { name } = drawBubble("src/index.ts");
    clickAt(name, TOP_NODE_CENTER_Y);
    assert.deepEqual(listFlashedFiles(), ["0f3c9a7e.jsonl", "b21d84c5.jsonl"]);
});

test("a bubble click leads with the session nearest the node level with the click", async () => {
    await openSessionPane();
    const { name } = drawBubble("src/index.ts");
    const readLead = (): string | undefined => document.querySelector<HTMLElement>(".session-item.flash-lead")?.dataset.file;

    clickAt(name, TOP_NODE_CENTER_Y);
    assert.equal(readLead(), "0f3c9a7e.jsonl");

    clickAt(name, BOTTOM_NODE_CENTER_Y);
    assert.equal(readLead(), "b21d84c5.jsonl");
});

test("a click on a node itself flashes nothing, since it opens the drawer", async () => {
    await openSessionPane();
    const { topNode } = drawBubble("src/index.ts");
    clickAt(topNode, TOP_NODE_CENTER_Y);
    assert.deepEqual(listFlashedFiles(), []);
});

test("a bubble click highlights without selecting", async () => {
    await openSessionPane();
    const { name } = drawBubble("src/index.ts");
    clickAt(name, TOP_NODE_CENTER_Y);
    assert.equal(document.querySelectorAll(".session-item.selected").length, 0);
    assert.deepEqual(listSelectedSessions(), []);
});

test("a session hidden by the search box does not light", async () => {
    await openSessionPane();
    typeSessionSearch("trim");
    const { name } = drawBubble("src/index.ts");
    clickAt(name, TOP_NODE_CENTER_Y);
    assert.deepEqual(listFlashedFiles(), ["b21d84c5.jsonl"]);
});
