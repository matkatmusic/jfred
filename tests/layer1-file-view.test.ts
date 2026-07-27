// Task 294: the Detail View drawer's body is a line-number column beside ONE highlighted block.
//
// No `hljs` global is defined here — node:test never loads the vendored script — so every case
// below exercises renderCodeInto's plain-text fallback. That is deliberate: what this file guards
// is the SHAPE (two columns, honest line count, real text) rather than the vendored tokeniser,
// which is not ours to test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLanguageForPath } from "../webapp/highlight.ts";
import { renderFileContentInto } from "../webapp/layer1-file-view.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

function renderIntoHost(content: string, path: string): HTMLElement {
    setupLayer1Dom();
    const host = document.createElement("div");
    renderFileContentInto(host, content, path);
    return host;
}

test("the gutter counts the file's real lines and the code column holds its text", () => {
    // The trailing newline must NOT earn a fourth row: it ends line 3 rather than starting a line.
    const host = renderIntoHost("alpha\nbeta\ngamma\n", "src/demo.ts");
    assert.equal(host.querySelector(".dgutter")?.textContent, "1\n2\n3");
    assert.equal(host.querySelector(".dcode")?.textContent, "alpha\nbeta\ngamma");
});

test("without the vendored hljs global the code column stays plain text", () => {
    const host = renderIntoHost("const x = 1;\n", "src/demo.ts");
    assert.equal(host.querySelector(".dcode")?.querySelectorAll("span").length, 0);
});

test("a file the highlighter has no language for is not an error", () => {
    assert.equal(computeLanguageForPath("notes.txt"), undefined);
    const host = renderIntoHost("plain text has no grammar to colour", "notes.txt");
    assert.equal(host.querySelector(".dcode")?.textContent, "plain text has no grammar to colour");
});
