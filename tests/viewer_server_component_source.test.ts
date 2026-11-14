// findComponentSource: maps a data-component name to the file and line where it is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, sep } from "node:path";
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

test("test_real_webapp_finds_timelineViewControls_in_show_row_html", () => {
    const realWebappDir = new Path(join(import.meta.dirname, "..", "webapp"));
    const source = findComponentSource(realWebappDir, "timelineViewControls");
    assert.ok(source.file.toString().endsWith(join("webapp", "layer1-components", "show-row", "show-row.html")));
    assert.equal(source.line, 1);
});

test("test_each_built_in_code_name_is_found_exactly_once_in_webapp", () => {
    // Step: point the lookup at the real webapp folder.
    const realWebappDir = new Path(join(import.meta.dirname, "..", "webapp"));
    // Step: list the names that layer1-layout.ts builds in code.
    const builtInCodeNames = [
        "headerContainer",
        "headerRowComponent",
        "sessionDataContainer",
        "sourcesContainer",
        "timelineComponentsContainer",
        "timelineContainer",
        "timelineRulerContainer",
        "fileBubbleContainer",
    ];
    // Step: look up each name. The lookup throws when a name is missing or appears twice.
    for (const builtInCodeName of builtInCodeNames) {
        assert.doesNotThrow(() => findComponentSource(realWebappDir, builtInCodeName));
    }
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

function collectTaggedComponentNames(webappDir: Path): string[] {
    const taggedNamePattern = /data-component["']?\s*[=:]\s*["']([^"']+)["']/g;
    const skippedFolderNames = new Set(["dist", "vendor", "archive"]);
    const names = new Set<string>();
    for (const relativePath of readdirSync(webappDir.toString(), { recursive: true, encoding: "utf8" })) {
        const folderNames = relativePath.split(sep).slice(0, -1);
        const isInSkippedFolder = folderNames.some((folderName) => skippedFolderNames.has(folderName));
        const isSearchedExtension = [".html", ".ts"].includes(extname(relativePath));
        if (!isInSkippedFolder && isSearchedExtension) {
            const text = readFileSync(join(webappDir.toString(), relativePath), "utf8");
            for (const match of text.matchAll(taggedNamePattern)) {
                names.add(match[1]!);
            }
        }
    }
    return [...names].sort();
}

test("test_copy_finds_one_file_and_line_for_every_tagged_part_in_the_webapp", () => {
    // Point at the real webapp folder.
    const webappDir = new Path(join(import.meta.dirname, "..", "webapp"));
    // Collect every distinct tag name written in its .html and .ts files.
    const names = collectTaggedComponentNames(webappDir);
    // Ask the lookup for each name and record every name whose call throws.
    const failures: string[] = [];
    for (const name of names) {
        try {
            findComponentSource(webappDir, name);
        } catch (error) {
            failures.push(`${name}: ${(error as Error).message}`);
        }
    }
    // Every name must resolve to exactly one place.
    assert.deepEqual(failures, []);
    // An empty scan must not pass.
    assert.ok(names.length >= 20, `only ${names.length} tag names found`);
});
