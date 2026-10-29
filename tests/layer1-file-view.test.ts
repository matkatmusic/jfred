// Guards the drawer body shape: a gutter column beside one code block, using the plain-text fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLanguageForPath } from "../webapp/highlight.ts";
import { isBinaryContent } from "../webapp/layer1-file-view.ts";
import { renderFileContentInto } from "../webapp/layer1-file-view.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function renderIntoHost(content: string, path: string): HTMLElement {
    initLayer1Dom();
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

test("a binary file is named, not dumped as mojibake", () => {
    // A PNG read as UTF-8 arrives as replacement characters around a NUL.
    const png = "\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR\ufffd\ufffd\ufffd\ufffd";
    assert.equal(isBinaryContent(png), true);
    const host = renderIntoHost(png, "assets/hero-timeline.png");
    assert.equal(host.querySelector(".dbinary")?.textContent, "Binary file — not shown as text.");
    assert.equal(host.querySelector(".dgutter"), null);
});

test("real source text is never mistaken for binary", () => {
    assert.equal(isBinaryContent("const x = 1;\nexport default x;\n"), false);
    // A single replacement character in prose is legitimate and must not trip the sniff.
    assert.equal(isBinaryContent("a line with one odd char \ufffd and plenty of ordinary text after"), false);
});
