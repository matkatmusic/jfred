// The component inspector on a real Bars page: a selected file row shows and copies the file and line where its name is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findComponentSource } from "../src/viewer_server_component_source.ts";
import { Path } from "../src/structures/domain.ts";
import { renderBarsRowsAndCutStrip } from "./layer1-bars-rendered-view-helpers.ts";

const realWebappDir = new Path(join(import.meta.dirname, "..", "webapp"));

let copiedTexts: string[] = [];

// Answers like the real route: the real lookup on the real webapp folder, sent as JSON text the way sendJson does.
async function fetchComponentSourceFromRealWebapp(requestUrl: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
    const componentName = new URL(requestUrl, "http://localhost:7343").searchParams.get("name")!;
    const source = findComponentSource(realWebappDir, componentName);
    return { ok: true, json: async () => JSON.parse(JSON.stringify(source)) };
}

function openBarsPageWithInspectorMarkup(): void {
    renderBarsRowsAndCutStrip();
    document.body.insertAdjacentHTML("beforeend", `<button id="toggle" data-component-inspector-toggle>names</button><div data-component-inspector-rows></div>`);
    copiedTexts = [];
    Object.assign(globalThis, { fetch: fetchComponentSourceFromRealWebapp });
    Object.defineProperty(globalThis, "navigator", {
        value: { clipboard: { writeText: async (text: string) => void copiedTexts.push(text) } },
        configurable: true,
    });
}

// Importing starts the module on the first page; each test installs again on its own page.
openBarsPageWithInspectorMarkup();
const { installComponentInspector } = await import("../webapp/component-inspector/component-inspector.ts");

function startInspector(): void {
    openBarsPageWithInspectorMarkup();
    installComponentInspector();
}

async function selectFirstBarsFileRow(): Promise<void> {
    document.getElementById("toggle")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    document.querySelector(".barsFileRow")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
}

function readInfoRowText(): string {
    return document.querySelector<HTMLElement>(".ci-info")!.textContent;
}

test("test_selecting_a_bars_file_row_shows_its_source_file_and_line_in_the_info_row", async () => {
    // Scenario: the info row of a selected Bars file row ends with (file:line), and that line is the real write of the name.
    // Open the Bars page with real rows.
    startInspector();
    // Switch the inspector on and click the changed file row.
    await selectFirstBarsFileRow();
    // Read the info row text.
    const infoRowText = readInfoRowText();
    // It names the Bars row source file and a line number.
    const locationMatch = /barsFileRow \((.+layer1-bars-row\.ts):(\d+)\)$/.exec(infoRowText);
    assert.ok(locationMatch !== null, `info row has no source location: ${infoRowText}`);
    // Read the line at that number from the file named in the text.
    const [, sourceFile, lineNumber] = locationMatch;
    const shownLine = readFileSync(sourceFile!, "utf8").split("\n")[Number(lineNumber) - 1]!;
    // The shown line is the real write of the name.
    assert.ok(shownLine.includes(`"data-component": "barsFileRow"`), `line ${lineNumber} is: ${shownLine}`);
});

test("test_pressing_copy_after_selecting_a_bars_file_row_writes_the_file_and_line", async () => {
    // Scenario: Copy after selecting a Bars file row writes one text holding the name, the source file, and the line.
    // Open the page, switch on, click the changed file row.
    startInspector();
    await selectFirstBarsFileRow();
    // Press Copy and flush promises.
    document.querySelector<HTMLElement>(".ci-copy")!.click();
    await new Promise((resolve) => setImmediate(resolve));
    // One text was written.
    assert.equal(copiedTexts.length, 1);
    // It holds the name, the source file, the line, and the hierarchy text.
    assert.match(copiedTexts[0]!, /^\{ barsFileRow, .+layer1-bars-row\.ts, \d+, .*barsFileRow \}$/);
});
