// findComponentSource: maps a data-component name to the file and line where it is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, sep } from "node:path";
import { findComponentSource } from "../src/viewer_server_component_source.ts";
import { Path } from "../src/structures/domain.ts";
import { renderBarsRowsAndCutStrip } from "./layer1-bars-rendered-view-helpers.ts";
import { relative } from "node:path";
import { collectComponentSourcesByName } from "../src/viewer_server_component_source.ts";

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

test("test_collects_every_tagged_name_with_each_file_and_line_it_is_written_on", () => {
    // Scenario: one name is written twice, one name once, and one name sits in a skipped folder.
    // Steps: build a webapp folder with those three cases.
    const webappDir = makeWebappDir({
        "a.html": "<div data-component=\"FileNav\"></div>\n<p data-component=\"Crumb\"></p>\n",
        "b.ts": "\n\"data-component\": \"FileNav\",\n",
        "dist/c.ts": "\"data-component\": \"Skipped\",\n",
    });
    // Steps: collect the names.
    const sourcesByName = collectComponentSourcesByName(webappDir);
    // Expect: the skipped folder adds no name.
    assert.deepEqual([...sourcesByName.keys()].sort(), ["Crumb", "FileNav"]);
    // Expect: FileNav lists both places, Crumb lists one.
    const fileNavPlaces = sourcesByName.get("FileNav")!.map((source) => `${relative(webappDir.toString(), source.file.toString())}:${source.line}`).sort();
    assert.deepEqual(fileNavPlaces, ["a.html:1", "b.ts:2"]);
    assert.equal(sourcesByName.get("Crumb")!.length, 1);
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

function collectRenderedComponentNames(): string[] {
    const names = new Set<string>();
    for (const element of document.querySelectorAll("[data-component]")) {
        names.add(element.getAttribute("data-component")!);
    }
    return [...names].sort();
}

const EXPECTED_BARS_NAMES = [
    "barsFileRow", "barsMark", "barsFilePath", "barsColLeft", "barsColMid", "barsColRight",
    "FileReconstructionProgressBar", "ProjectLifetimeBar", "barsFill", "barsDotStrip", "BarDot",
    "barsHistoryBlock", "barsPlusSign", "barsMinusSign", "barsMovedAwaySign",
    "barsCutStripLeft", "barsCutStripMiddle", "barsCutStripRight", "barsCutBranchLine",
    "barsCutDottedLine", "barsCutCap", "barsCutHashLabel",
];

test("test_every_name_the_bars_view_renders_resolves_to_one_file_and_line", () => {
    // Step: render real Bars rows and the cut strip into one DOM.
    renderBarsRowsAndCutStrip();
    // Step: collect every data-component value present in the rendered DOM.
    const renderedNames = collectRenderedComponentNames();
    // Step: all 22 names that were built from variables must be present, so a thin render cannot pass.
    for (const expectedName of EXPECTED_BARS_NAMES) {
        assert.ok(renderedNames.includes(expectedName), `${expectedName} was not rendered`);
    }
    // Step: look up each rendered name in the real webapp folder. The lookup throws for 0 or 2+ places, so the first bad name fails the test.
    const webappDir = new Path(join(import.meta.dirname, "..", "webapp"));
    for (const renderedName of renderedNames) {
        findComponentSource(webappDir, renderedName);
    }
});

test("test_find_component_source_skips_a_commented_out_line_with_the_same_name", () => {
    // Scenario: an old line kept as a comment and the live line both hold data-component "OldRow".
    // Steps: build a webapp folder with one .ts file: line 1 is the commented-out copy, line 2 is the live line.
    const webappDir = makeWebappDir({
        "row.ts": "    // createElement(\"div\", { \"data-component\": \"OldRow\" }),\n    createElement(\"div\", { \"data-component\": \"OldRow\" }),\n",
    });
    // Expect: one match, on the live line 2, and no "written more than once" error.
    const source = findComponentSource(webappDir, "OldRow");
    assert.equal(source.line, 2);
});

test("test_collect_component_sources_skips_a_commented_out_line_with_the_same_name", () => {
    // Scenario: the same two lines as above.
    const webappDir = makeWebappDir({
        "row.ts": "    // createElement(\"div\", { \"data-component\": \"OldRow\" }),\n    createElement(\"div\", { \"data-component\": \"OldRow\" }),\n",
    });
    // Expect: OldRow has exactly one source, the live line 2.
    const sources = collectComponentSourcesByName(webappDir).get("OldRow")!;
    assert.deepEqual(sources.map((source) => source.line), [2]);
});
