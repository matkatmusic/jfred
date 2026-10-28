// DOM tests for renderConversationView (webapp/views/conversation.ts) against a canned document and raw transcript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

const CONVERSATION_DOCUMENT = {
    messages: [{ uuid: "u1", role: "user", text: "hello there" }],
    lineVerdicts: [
        { uuid: "u1", line: 0, type: "user", verdict: "kept" },
        { uuid: "s1", line: 1, type: "system", verdict: "folded" },
    ],
    branches: [{ isSurviving: true, tip: "abcdef1234567890" }],
    filesTouched: [{ target: "/a/b.ts", revisions: [{ changeId: "chg-1" }] }],
};
const RAW_TRANSCRIPT = '{"uuid":"u1"}\n{"uuid":"s1","note":"chg-1"}\n';

// Seeds the fetch caches so the view renders with no stream and no delayed console-close timer.
async function renderInFreshDom(project: string, anchorLine: string | undefined): Promise<HTMLElement> {
    initWebappDom();
    const { documentCache, rawLinesCache } = await import("../webapp/app-fetch.ts");
    documentCache.set(`${project}|s.jsonl`, CONVERSATION_DOCUMENT);
    rawLinesCache.set(`${project}|s.jsonl`, RAW_TRANSCRIPT.trim().split("\n"));
    const { renderConversationView } = await import("../webapp/views/conversation.ts");
    const container = document.createElement("div");
    await renderConversationView(container, project, "s.jsonl", anchorLine);
    return container;
}

test("test_renderConversationView_renders_bubble_stub_strip_and_edit_marker", async () => {
    // Scenario: one message line is a bubble, the other a stub, plus a branch strip and edit marker.
    const container = await renderInFreshDom("conv-a", undefined);
    // assert each node kind appears once with its expected text.
    assert.equal(container.querySelectorAll(".bubble.user").length, 1);
    assert.equal(container.querySelector(".stub-row")!.textContent, "line 1 · system · folded");
    assert.equal(container.querySelector(".branch-chip")!.textContent, "surviving · tip abcdef12");
    const marker = container.querySelector(".edit-marker")!;
    assert.equal(marker.textContent, "✎ b.ts");
    assert.equal(marker.getAttribute("href"), "#/project/conv-a/file/%2Fa%2Fb.ts");
});

test("test_renderConversationView_marks_the_anchor_line_node", async () => {
    // Scenario: an anchor line index marks exactly the node for that line.
    const container = await renderInFreshDom("conv-b", "1");
    // assert only the stub row (line 1) carries the anchored class.
    const anchoredNodes = container.querySelectorAll(".anchored");
    assert.equal(anchoredNodes.length, 1);
    assert.ok(anchoredNodes[0]!.classList.contains("stub-row"));
});

test("test_renderConversationView_raw_lines_button_sets_the_lines_route", async () => {
    // Scenario: the Raw lines button sends the page to the conversation lines route.
    const container = await renderInFreshDom("conv-c", undefined);
    (container.querySelector(".row-btn") as HTMLElement).click();
    // assert the hash names the project and jsonl file.
    assert.equal(location.hash, "#/project/conv-c/jsonl/s.jsonl/lines");
});
