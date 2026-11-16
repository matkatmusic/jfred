// Task 809: every data-component name of the page files has a row in the names section of the glossary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectComponentSourcesByName } from "../src/viewer_server_component_source.ts";
import { Path } from "../src/structures/domain.ts";

const WEBAPP_DIR = new Path(join(import.meta.dirname, "..", "webapp"));
const GLOSSARY_PATH = new Path(join(import.meta.dirname, "..", "docs", "ui-component-glossary.md"));
const SECTION_HEADING = "## Every data-component name";

function listGlossaryNames(): string[] {
    const glossaryText = readFileSync(GLOSSARY_PATH.toString(), "utf8");
    const sectionText = glossaryText.slice(glossaryText.indexOf(SECTION_HEADING));
    const names: string[] = [];
    for (const line of sectionText.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        const isTableRow = line.startsWith("|") && cells.length >= 4;
        if (isTableRow) {
            const isNameCell = /^[A-Za-z][A-Za-z0-9]*$/.test(cells[1]!);
            if (isNameCell) {
                const isHeaderRow = cells[1] === "Name";
                if (!isHeaderRow) {
                    names.push(cells[1]!);
                }
            }
        }
    }
    return names;
}

test("test_every_page_component_name_has_a_glossary_row", () => {
    // Scenario: a part was added to the page and nobody wrote its glossary row, or a row outlived its part.
    // Steps: list the names on the pages and the names in the glossary section; check both directions.
    // Expect: no page name lacks a row. RED prints the 18 names of the plan.
    const glossaryNames = new Set(listGlossaryNames());
    const pageNames = [...collectComponentSourcesByName(WEBAPP_DIR).keys()];
    const missing = pageNames.filter((name) => !glossaryNames.has(name)).sort();
    assert.deepEqual(missing, []);
    // Expect: no glossary row names a part that is no longer on any page.
    const pageNameSet = new Set(pageNames);
    const extraRows = [...glossaryNames].filter((name) => !pageNameSet.has(name)).sort();
    assert.deepEqual(extraRows, []);
});
