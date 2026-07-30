// Task 292: the JSONLs pane's selection rules and the filter targets they produce.
//
// Pinned because "a re-click on the ONLY pick clears it" is the half that is easy to drop.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    listSelectedSessions,
    listSessionFilterTargets,
    renderSessionPane,
    resetSessionSelection,
    setKnownProjectPaths,
} from "../webapp/layer1-sessions.ts";
import { readSourcePaths, writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { setupLayer1Dom, stubStreamRoute } from "./webapp-dom-test-helpers.ts";

const PROJECT_FOLDER = "/Users/you/code/demo-app";
// Transcripts record ABSOLUTE paths; the fixture is absolute so the relative translation is exercised, not assumed.
const SESSIONS = [
    { file: "0f3c9a7e.jsonl", fullPath: "/p/0f3c9a7e.jsonl", title: "seed the demo app",
        started: "2026-06-01T08:44:00Z", ended: "2026-06-01T09:12:00Z",
        paths: [`${PROJECT_FOLDER}/src/index.ts`, `${PROJECT_FOLDER}/README.md`] },
    { file: "b21d84c5.jsonl", fullPath: "/p/b21d84c5.jsonl", title: "extract the trim helper",
        started: "2026-06-01T14:05:00Z", ended: "2026-06-03T18:40:00Z",
        // src/index.ts is shared with the first session, so the union has to de-duplicate it.
        paths: [`${PROJECT_FOLDER}/src/index.ts`, `${PROJECT_FOLDER}/src/util.ts`] },
    // Touched nothing this project draws: the pane must not list it at all.
    { file: "ffffffff.jsonl", fullPath: "/p/ffffffff.jsonl", title: "an unrelated project",
        started: "2026-06-02T00:00:00Z", ended: "2026-06-02T01:00:00Z",
        paths: ["/Users/you/code/other-app/main.go"] },
];
// What the drawn view knows about, in the view's own relative spelling.
const KNOWN_PATHS = ["src/index.ts", "src/util.ts", "README.md"];

// The stub answers /api/layer1-sessions and the source list points somewhere; an empty list means no fetch.
async function openSessionPane(): Promise<void> {
    setupLayer1Dom();
    writeSourcePaths(SourceKind.jsonl, ["/p"]);
    // Task 304: the pane reads the endpoint as an NDJSON stream, so the stub answers one.
    stubStreamRoute("/api/layer1-sessions", [
        { kind: "progress", label: "scanning JSONL files", current: 1, total: 3 },
        { sessions: SESSIONS },
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
