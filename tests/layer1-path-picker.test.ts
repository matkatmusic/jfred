// Tasks 295/296: an empty folder must be REFUSED, and [cancel] must leave the live list unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { openPicker, registerPathPickers } from "../webapp/layer1-path-picker.ts";
import { readSourcePaths, writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const PICKED_FOLDER = "/Users/you/Programming/jot-recovery/claude-data/projects";

// `found` is the /api/scan-source answer deciding whether the picked folder is admitted.
function stubPickerRoutes(pickedPath: string, found: number): void {
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            const pathname = new URL(String(url), "http://localhost:7343").pathname;
            // Mirrors the real /api/pick-folder: `paths` is the multi-select result, empty on cancel.
            const pickedPaths = pickedPath === "" ? [] : [pickedPath];
            const body = pathname === "/api/pick-folder" ? { path: pickedPaths[0] ?? "", paths: pickedPaths } : { found };
            return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
        },
    });
}

// Fresh DOM and stub with both lists emptied, since lists are shared module state; returns an onChanged counter.
function openPickerPage(pickedPath: string, found: number): { changes: () => number } {
    initLayer1Dom();
    stubPickerRoutes(pickedPath, found);
    writeSourcePaths(SourceKind.jsonl, []);
    writeSourcePaths(SourceKind.fileHistory, []);
    let changeCount = 0;
    registerPathPickers(() => { changeCount += 1; });
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

function isDisabled(id: string): boolean {
    return (getRequiredElementById(id) as HTMLButtonElement).disabled;
}

async function pickRow(index: number): Promise<void> {
    getRequiredElementById("pp-list").children[index]!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test("up and down are disabled with no row selected, and at the ends of the list", async () => {
    openPickerPage(PICKED_FOLDER, 148);
    writeSourcePaths(SourceKind.jsonl, ["/a", "/b", "/c"]);
    openPicker(SourceKind.jsonl);
    assert.equal(isDisabled("pp-up"), true);
    assert.equal(isDisabled("pp-down"), true);
    await pickRow(0);
    assert.equal(isDisabled("pp-up"), true);
    assert.equal(isDisabled("pp-down"), false);
    await pickRow(2);
    assert.equal(isDisabled("pp-up"), false);
    assert.equal(isDisabled("pp-down"), true);
});

test("up and down move the selected row one place, keep it selected, and set-and-close saves the order", async () => {
    const page = openPickerPage(PICKED_FOLDER, 148);
    writeSourcePaths(SourceKind.jsonl, ["/a", "/b", "/c"]);
    openPicker(SourceKind.jsonl);
    await pickRow(1);
    await clickAndSettle("pp-up");
    assert.deepEqual(listDrawnPaths(), ["/b", "/a", "/c"]);
    assert.equal(getRequiredElementById("pp-list").children[0]!.classList.contains("picked"), true);
    await pickRow(1);
    await clickAndSettle("pp-down");
    assert.deepEqual(listDrawnPaths(), ["/b", "/c", "/a"]);
    assert.equal(getRequiredElementById("pp-list").children[2]!.classList.contains("picked"), true);
    await clickAndSettle("pp-ok");
    assert.deepEqual([...readSourcePaths(SourceKind.jsonl)], ["/b", "/c", "/a"]);
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
