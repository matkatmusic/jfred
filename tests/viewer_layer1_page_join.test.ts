import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinLayer1Page } from "../src/viewer_layer1_page_join.ts";

// A shell folder with one component part that itself includes a nested part.
function createShellFolder(): string {
    const shellDir = mkdtempSync(join(tmpdir(), "layer1-page-join-"));
    mkdirSync(join(shellDir, "layer1-components", "outer"), { recursive: true });
    mkdirSync(join(shellDir, "layer1-components", "inner"), { recursive: true });
    writeFileSync(join(shellDir, "layer1-components", "outer", "outer.html"), "  <div>\n    <!-- include layer1-components/inner/inner.html -->\n  </div>\n");
    writeFileSync(join(shellDir, "layer1-components", "inner", "inner.html"), "    <span>in</span>\n");
    return shellDir;
}

test("test_joinLayer1Page_replaces_include_lines_recursively", () => {
    // Scenario: the shell names one part; that part names a nested part.
    const shellDir = createShellFolder();
    writeFileSync(join(shellDir, "layer1.html"), "<body>\n    <!-- include layer1-components/outer/outer.html -->\n</body>\n");
    // Each include line becomes the part's lines, and no line break is added or lost.
    const page = joinLayer1Page(join(shellDir, "layer1.html"));
    assert.equal(page, "<body>\n  <div>\n    <span>in</span>\n  </div>\n</body>\n");
});

test("test_joinLayer1Page_keeps_a_part_without_trailing_newline", () => {
    // Scenario: a part file that ends without a newline joins the same way.
    const shellDir = createShellFolder();
    writeFileSync(join(shellDir, "layer1-components", "inner", "inner.html"), "    <span>in</span>");
    writeFileSync(join(shellDir, "layer1.html"), "<body>\n<!-- include layer1-components/inner/inner.html -->\n</body>\n");
    assert.equal(joinLayer1Page(join(shellDir, "layer1.html")), "<body>\n    <span>in</span>\n</body>\n");
});

test("test_joinLayer1Page_accepts_an_include_split_over_three_lines", () => {
  // Scenario: the html formatting hook rewrites the include comment as open, text, and close lines.
  const shellDir = createShellFolder();
  writeFileSync(join(shellDir, "layer1.html"), "<body>\n  <!--\n    include layer1-components/inner/inner.html\n  -->\n</body>\n");
  assert.equal(joinLayer1Page(join(shellDir, "layer1.html")), "<body>\n    <span>in</span>\n</body>\n");
});

test("test_joinLayer1Page_leaves_a_comment_with_other_text_on_its_line", () => {
    // Scenario: an include comment that shares its line with markup is not an include line.
    const shellDir = createShellFolder();
    const shellHtml = "<p>x</p> <!-- include layer1-components/inner/inner.html -->\n";
    writeFileSync(join(shellDir, "layer1.html"), shellHtml);
    assert.equal(joinLayer1Page(join(shellDir, "layer1.html")), shellHtml);
});

test("test_joinLayer1Page_throws_on_missing_part", () => {
    // Scenario: the shell names a part file that does not exist.
    const shellDir = createShellFolder();
    writeFileSync(join(shellDir, "layer1.html"), "<!-- include layer1-components/gone/gone.html -->\n");
    assert.throws(() => joinLayer1Page(join(shellDir, "layer1.html")), /ENOENT/);
});
