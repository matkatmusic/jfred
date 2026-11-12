// A long diff line wraps inside the DiffViewSections component instead of running off to the right.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendInlineDiff } from "../webapp/diff-render.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const LONG_TOKEN = "x".repeat(2000);
const DIFF_TEXT = `@@ -1,1 +1,1 @@\n+${LONG_TOKEN}`;

// The page loads these sheets; the test DOM cannot lay out text, so computed styles are the honest check.
function loadDiffViewStyles(): void {
    const style = document.createElement("style");
    style.textContent = readFileSync(new URL("../webapp/layer1-components/details-drawer/diff-view.css", import.meta.url), "utf8");
    document.head.append(style);
}

function renderLongInlineLine(): HTMLElement {
    initLayer1Dom();
    loadDiffViewStyles();
    const body = document.createElement("div");
    getBodyHost().append(body);
    appendInlineDiff(body, DIFF_TEXT, "notes.txt");
    return body;
}

function getBodyHost(): HTMLElement {
    return document.getElementById("dbody")!;
}

test("an inline diff line wraps, even inside one long token with no spaces", () => {
    // Steps: render an inline diff holding a 2000-character unbroken added line, then read its wrap styling.
    const body = renderLongInlineLine();
    const shown = window.getComputedStyle(body.querySelector(".diff-line.add")!);
    assert.equal(shown.whiteSpace, "pre-wrap");
    assert.equal(shown.overflowWrap, "anywhere");
});

test("the inline diff is not forced wider than its section", () => {
    // Steps: render the same diff, then read the min-width of the diff block; max-content would force sideways scrolling.
    const body = renderLongInlineLine();
    assert.notEqual(window.getComputedStyle(body.querySelector(".diff")!).minWidth, "max-content");
});

test("the inline diff text cell may shrink below its content width", () => {
    // Steps: render the same diff, then read the min-width of the text cell; a flex item needs 0 to wrap.
    const body = renderLongInlineLine();
    assert.equal(window.getComputedStyle(body.querySelector(".diff-body")!).minWidth, "0");
});
