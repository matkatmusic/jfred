// Task 812: the inspector markup, script and hover work on the layered page and the debug page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { collectComponentSourcesByName } from "../src/viewer_server_component_source.ts";
import { Path } from "../src/structures/domain.ts";

const WEBAPP_DIR = new Path(join(import.meta.dirname, "..", "webapp"));
const INSPECTOR_SCRIPT = 'src="/app/component-inspector/component-inspector.js"';
const INSPECTOR_FIXTURE_BODY = "<button data-component-inspector-toggle></button><div data-component-inspector-rows></div>";

const PAGES = [
    { file: "index.html", hoverId: "layered-timeline", hoverName: "layeredTimeline" },
    { file: "debug.html", hoverId: "debug-file-list", hoverName: "debugFileList" },
];

function readPageText(file: string): string {
    return readFileSync(join(WEBAPP_DIR.toString(), file), "utf8");
}

// Opens the given body markup on a fresh window with a fake source route.
function openBodyMarkup(bodyMarkup: string): void {
    const browserWindow = new Window({ url: "http://localhost:7343/" });
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        fetch: async () => ({ ok: true, json: async () => ({ file: "/abs/page.html", line: 1 }) }),
    });
    browserWindow.document.body.innerHTML = bodyMarkup;
}

// Opens the body of a page file on a fresh window; script tags are cut out so nothing loads.
function openPageBody(file: string): void {
    const body = /<body>([\s\S]*)<\/body>/.exec(readPageText(file))![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
    openBodyMarkup(body);
}

// Importing starts the module on a small fixture body that always has the toggle and the rows box (as tests/component-inspector.test.ts does), so the import cannot throw. Each page test installs again on its own window.
openBodyMarkup(INSPECTOR_FIXTURE_BODY);
const { installComponentInspector } = await import("../webapp/component-inspector/component-inspector.ts");

for (const page of PAGES) {
    test(`test_${page.file}_has_the_toggle_the_rows_box_and_the_inspector_script`, () => {
        // Scenario: the page file carries everything the inspector needs.
        const text = readPageText(page.file);
        assert.equal(text.split("data-component-inspector-toggle").length - 1, 1);
        assert.equal(text.split("data-component-inspector-rows").length - 1, 1);
        assert.ok(text.includes(INSPECTOR_SCRIPT));
    });

    test(`test_${page.file}_hover_shows_the_name_of_the_part_when_names_is_on`, () => {
        // Scenario: names switched on, the pointer moves over a part of the page.
        // Steps: open the page body, install the inspector, click the names button, move over the part.
        openPageBody(page.file);
        installComponentInspector();
        document.querySelector<HTMLElement>("[data-component-inspector-toggle]")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
        document.getElementById(page.hoverId)!.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true }));
        // Expect: the overlay is shown and its label is the part's name.
        assert.equal(document.querySelector<HTMLElement>(".ci-overlay")!.hidden, false);
        assert.equal(document.querySelector(".ci-label")!.textContent, page.hoverName);
    });

    test(`test_${page.file}_component_names_are_used_once_in_the_webapp`, () => {
        // Scenario: the source lookup finds a name by scanning webapp/; a name used twice would point at the wrong file.
        const pageFilePath = join(WEBAPP_DIR.toString(), page.file);
        const ownNames: string[] = [];
        const usedMoreThanOnce: string[] = [];
        for (const [name, sources] of collectComponentSourcesByName(WEBAPP_DIR)) {
            const isOnThisPage = sources.some((source) => source.file.toString() === pageFilePath);
            if (isOnThisPage) {
                ownNames.push(name);
                if (sources.length > 1) {
                    usedMoreThanOnce.push(name);
                }
            }
        }
        assert.ok(ownNames.length > 0);
        assert.deepEqual(usedMoreThanOnce, []);
    });
}
