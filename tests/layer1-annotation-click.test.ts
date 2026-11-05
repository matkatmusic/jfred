// Clicking a session dot opens the Details drawer on that dot's JSON line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { installAnnotationClick } from "../webapp/layer1-components/session-column/layer1-annotation-click.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

function drawDot(): HTMLElement {
    const dot = createElement("i", { class: "anode a-user", "data-session-file": "/fixture/demo/projects/0f3c9a7e.jsonl",
        "data-line": "1007", "data-session-title": "seed the demo app", "data-record-label": "fix the trim bug" });
    getRequiredElementById("stage").replaceChildren(dot);
    return dot;
}

test("test_clicking_a_dot_opens_the_drawer_with_title_label_and_the_fetched_json", async () => {
    // Steps: click a dot, wait, then check the request, heading and JSON box.
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ type: "user", note: "dot json line" }));
    const dot = drawDot();
    installAnnotationClick();
    dot.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    const params = new URLSearchParams(asks[0]!.url.split("?")[1]);
    assert.equal(params.get("jsonl"), "/fixture/demo/projects/0f3c9a7e.jsonl");
    assert.equal(params.get("line"), "1007");
    assert.ok(getRequiredElementById("drawer").classList.contains("open"));
    assert.equal(getRequiredElementById("dpath").textContent, "seed the demo app");
    assert.equal(getRequiredElementById("dmeta").textContent, "fix the trim bug");
    assert.ok(getRequiredElementById("dbody").textContent?.includes("dot json line"));
});

test("test_clicking_something_that_is_not_a_dot_asks_for_nothing", async () => {
    // Steps: click a plain element, wait, expect no request.
    initLayer1Dom();
    const asks = installRecordingFetch(() => ({}));
    const plain = createElement("div");
    getRequiredElementById("stage").replaceChildren(plain);
    installAnnotationClick();
    plain.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    assert.equal(asks.length, 0);
});
