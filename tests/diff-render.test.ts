// Diff rows are syntax-highlighted through the shared hljs machinery, in both layouts (task 305 follow-up).

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendColumnsDiff, appendInlineDiff } from "../webapp/diff-render.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

const TS_DIFF = "@@ -1 +1,2 @@\n const shared = 1;\n+const added = 2;";

// A recognizable stand-in for the vendored script-tag global, absent under node:test.
function stubHljs(): void {
    Object.assign(globalThis, { hljs: {
        getLanguage: () => ({}),
        highlight: (code: string) => ({ value: `<span class="hljs-keyword">${code}</span>` }),
    } });
}

function dropHljs(): void {
    delete (globalThis as { hljs?: unknown }).hljs;
}

function makeHost(): HTMLElement {
    setupLayer1Dom();
    return document.createElement("div");
}

test("inline rows highlight the code after the ± marker for a .ts path", () => {
    const host = makeHost();
    stubHljs();
    appendInlineDiff(host, TS_DIFF, "src/demo.ts");
    const addBody = host.querySelector(".diff-line.add .diff-body")!;
    // The marker stays plain text; only the code behind it carries token spans.
    assert.equal(addBody.textContent, "+const added = 2;");
    assert.equal(addBody.querySelector("span.hljs-keyword")?.textContent, "const added = 2;");
    // The hunk header row stays plain.
    assert.equal(host.querySelector(".diff-line.hunk .diff-body")?.querySelector("span"), null);
});

test("split cells lead with their marker and highlight only the code behind it", () => {
    const host = makeHost();
    stubHljs();
    appendColumnsDiff(host, TS_DIFF, "src/demo.ts");
    const addCell = host.querySelector(".dc-body.dc-add")!;
    // Task 319: every split text cell leads with its +/-/space marker (mockup parity).
    assert.equal(addCell.textContent, "+const added = 2;");
    assert.equal(addCell.querySelector("span.hljs-keyword")?.textContent, "const added = 2;");
    const contextCell = host.querySelector(".dc-body:not(.dc-add):not(.dc-del)")!;
    assert.equal(contextCell.textContent, " const shared = 1;");
    // The right-side filler cell opposite the lone addition stays empty.
    const bodies = [...host.querySelectorAll(".dc-body")];
    assert.ok(bodies.some((cell) => cell.textContent === ""));
});

test("without the hljs global both layouts fall back to plain text", () => {
    const host = makeHost();
    dropHljs();
    appendInlineDiff(host, TS_DIFF, "src/demo.ts");
    appendColumnsDiff(host, TS_DIFF, "src/demo.ts");
    assert.equal(host.querySelector(".hljs-keyword"), null);
    assert.equal(host.querySelector(".diff-line.add .diff-body")?.textContent, "+const added = 2;");
    assert.equal(host.querySelector(".dc-body.dc-add")?.textContent, "+const added = 2;");
});
