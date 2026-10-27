// A bubble click flashes the sessions that touched its file; a node click flashes nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { wireBubbleFlash } from "../webapp/layer1-session-flash.ts";
import { renderSessionPane } from "../webapp/layer1-session-pane.ts";
import { loadLayer1Sessions, resetSessionSelection } from "../webapp/layer1-sessions.ts";
import { writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const SESSION = { file: "a.jsonl", fullPath: "/p/a.jsonl", titles: [],
    started: "2026-06-01T08:00:00Z", ended: "2026-06-01T09:00:00Z", paths: ["src/a.ts"] };

async function openBubble(): Promise<{ name: HTMLElement; node: HTMLElement }> {
    initLayer1Dom();
    writeSourcePaths(SourceKind.jsonl, ["/p"]);
    stubStreamRoute("/api/layer1-sessions", [{ sessions: [SESSION] }]);
    resetSessionSelection();
    await loadLayer1Sessions();
    renderSessionPane(() => {});
    const box = document.createElement("div");
    box.className = "filebox";
    const name = document.createElement("span");
    name.className = "fname";
    name.dataset.path = "src/a.ts";
    const node = document.createElement("i");
    node.className = "node";
    node.dataset.instant = "2026-06-01T08:30:00Z";
    box.append(name, node);
    document.getElementById("stage")!.append(box);
    wireBubbleFlash();
    return { name, node };
}

test("test_wireBubbleFlash_flashes_the_session_that_touched_the_file", async () => {
    const { name } = await openBubble();
    name.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(document.querySelectorAll(".session-item.flash-lead").length, 1);
});

test("test_wireBubbleFlash_ignores_a_node_click", async () => {
    const { node } = await openBubble();
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(document.querySelectorAll(".session-item.flash").length, 0);
});
