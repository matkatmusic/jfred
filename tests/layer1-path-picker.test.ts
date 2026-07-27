// Tasks 295/296: the shared source-folder dialog.
//
// What is guarded here is the two rules a folder picker can silently get wrong: a folder holding
// none of what the list is for must be REFUSED rather than added (a source path that contributes
// nothing is a lie about the build's inputs), and [cancel] must leave the live list exactly as it
// was — the dialog edits a copy precisely so a mis-click on [−] is recoverable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { openPicker, wirePathPickers } from "../webapp/layer1-path-picker.ts";
import { readSourcePaths, SourceKind, writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

const PICKED_FOLDER = "/Users/you/Programming/jot-recovery/claude-data/projects";

// A stub whose /api/scan-source answer is chosen per test: `found` is what decides whether the
// picked folder is admitted at all.
function stubPickerRoutes(pickedPath: string, found: number): void {
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            const pathname = new URL(String(url), "http://localhost:7343").pathname;
            const body = pathname === "/api/pick-folder" ? { path: pickedPath } : { found };
            return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
        },
    });
}

// Fresh DOM, fresh stub, and both source lists emptied — the lists are module state shared with the
// picker, so a list a previous test committed would make the next test's [+] a duplicate and a
// no-op. `onChanged` is returned as a counter so the commit path can be asserted exactly once.
function openPickerPage(pickedPath: string, found: number): { changes: () => number } {
    setupLayer1Dom();
    stubPickerRoutes(pickedPath, found);
    writeSourcePaths(SourceKind.jsonl, []);
    writeSourcePaths(SourceKind.fileHistory, []);
    let changeCount = 0;
    wirePathPickers(() => { changeCount += 1; });
    return { changes: () => changeCount };
}

// The click handlers are async, so the assertions run after the microtask queue drains.
async function clickAndSettle(id: string): Promise<void> {
    getRequiredElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function listDrawnPaths(): string[] {
    return [...getRequiredElementById("pp-list").querySelectorAll("div")]
        .filter((row) => !row.classList.contains("mempty"))
        .map((row) => row.textContent ?? "");
}

test("a folder holding none of what the list is for is refused, with an alert", async () => {
    openPickerPage(PICKED_FOLDER, 0);
    openPicker(SourceKind.jsonl);
    await clickAndSettle("pp-add");
    assert.deepEqual(listDrawnPaths(), []);
    assert.equal(getRequiredElementById("pp-alert").hidden, false);
    assert.equal(getRequiredElementById("pp-alert").textContent, "no JSONL files found");
});

test("a folder that holds JSONLs is added and selected", async () => {
    openPickerPage(PICKED_FOLDER, 148);
    openPicker(SourceKind.jsonl);
    await clickAndSettle("pp-add");
    assert.deepEqual(listDrawnPaths(), [PICKED_FOLDER]);
    // Selecting it is what makes [-] usable without a second click.
    assert.equal((getRequiredElementById("pp-remove") as HTMLButtonElement).disabled, false);
});

test("cancel drops the draft; set-and-close commits it and reports the change once", async () => {
    const page = openPickerPage(PICKED_FOLDER, 148);

    openPicker(SourceKind.jsonl);
    await clickAndSettle("pp-add");
    await clickAndSettle("pp-cancel");
    assert.equal(readSourcePaths(SourceKind.jsonl).includes(PICKED_FOLDER), false);
    assert.equal(page.changes(), 0);

    openPicker(SourceKind.jsonl);
    await clickAndSettle("pp-add");
    await clickAndSettle("pp-ok");
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], [PICKED_FOLDER]);
    assert.equal(page.changes(), 1);
});

test("opening the other list hides an alert the first one left up", async () => {
    openPickerPage(PICKED_FOLDER, 0);
    openPicker(SourceKind.jsonl);
    await clickAndSettle("pp-add");
    assert.equal(getRequiredElementById("pp-alert").hidden, false);
    // A warning about the LAST list is not about this one.
    openPicker(SourceKind.fileHistory);
    assert.equal(getRequiredElementById("pp-alert").hidden, true);
    assert.equal(getRequiredElementById("pp-title").textContent, "File History Snapshot Paths");
});
