// findComponentSource: maps a data-component name to the file and line where it is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findComponentSource } from "../src/viewer_server_component_source.ts";
import { Path } from "../src/structures/domain.ts";

function makeWebappDir(files: Record<string, string>): Path {
    const webappDir = mkdtempSync(join(tmpdir(), "component-source-"));
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = join(webappDir, relativePath);
        mkdirSync(join(filePath, ".."), { recursive: true });
        writeFileSync(filePath, content);
    }
    return new Path(webappDir);
}

test("test_finds_the_line_of_an_html_data_component_tag", () => {
    const webappDir = makeWebappDir({ "page.html": "<body>\n<div>\n<section data-component=\"FileNav\"></section>\n</div>\n" });
    const source = findComponentSource(webappDir, "FileNav");
    assert.equal(source.file.toString(), join(webappDir.toString(), "page.html"));
    assert.equal(source.line, 3);
});

test("test_finds_the_line_of_a_ts_data_component_key", () => {
    const webappDir = makeWebappDir({ "views/nav.ts": "const attrs = {\n    class: \"nav\",\n    \"data-component\": \"FileNav\",\n};\n" });
    const source = findComponentSource(webappDir, "FileNav");
    assert.equal(source.file.toString(), join(webappDir.toString(), "views", "nav.ts"));
    assert.equal(source.line, 3);
});

test("test_exact_name_only_file_nav_does_not_match_file_nav_pane", () => {
    const webappDir = makeWebappDir({
        "a.html": "<div data-component=\"FileNavPane\"></div>\n",
        "b.html": "<div data-component=\"FileNav\"></div>\n",
    });
    const source = findComponentSource(webappDir, "FileNav");
    assert.equal(source.file.toString(), join(webappDir.toString(), "b.html"));
});

test("test_skips_files_under_dist", () => {
    const webappDir = makeWebappDir({
        "dist/built.html": "<div data-component=\"FileNav\"></div>\n",
        "src.html": "<div data-component=\"FileNav\"></div>\n",
    });
    const source = findComponentSource(webappDir, "FileNav");
    assert.equal(source.file.toString(), join(webappDir.toString(), "src.html"));
});

test("test_throws_when_the_name_is_missing", () => {
    const webappDir = makeWebappDir({ "page.html": "<div data-component=\"Other\"></div>\n" });
    assert.throws(() => findComponentSource(webappDir, "FileNav"), /FileNav/);
});

test("test_real_webapp_finds_ShowRow_in_show_row_html", () => {
    const realWebappDir = new Path(join(import.meta.dirname, "..", "webapp"));
    const source = findComponentSource(realWebappDir, "ShowRow");
    assert.ok(source.file.toString().endsWith(join("webapp", "layer1-components", "show-row", "show-row.html")));
    assert.equal(source.line, 1);
});

test("test_throws_when_the_name_appears_twice_and_lists_both_locations", () => {
    const webappDir = makeWebappDir({
        "a.html": "<div data-component=\"FileNav\"></div>\n",
        "b.ts": "\n\"data-component\": \"FileNav\",\n",
    });
    assert.throws(
        () => findComponentSource(webappDir, "FileNav"),
        (error: Error) => {
            assert.match(error.message, /a\.html:1/);
            assert.match(error.message, /b\.ts:2/);
            return true;
        },
    );
});
