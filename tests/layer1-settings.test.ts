// Task 297: the Save button and the restore that reads its file back; a failed save stays armed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import {
    attachSettingsSave,
    markSettingsDirty,
    saveFolderCollapseState,
} from "../webapp/layer1-settings.ts";
import { SAVED_PROJECT, settle, stubSettingsRoute } from "./layer1-settings-test-helpers.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function isSaveButtonDisabled(): boolean {
    return (getRequiredElementById("save-settings") as HTMLButtonElement).disabled;
}

test("editing a saved field arms the button and drops the stale note", () => {
    initLayer1Dom();
    stubSettingsRoute(null, true);
    attachSettingsSave();
    getRequiredElementById("saved-note").textContent = "saved";
    assert.equal(isSaveButtonDisabled(), true);

    getInputById("repo").dispatchEvent(new window.Event("input", { bubbles: true }));

    assert.equal(isSaveButtonDisabled(), false);
    assert.equal(getRequiredElementById("saved-note").textContent, "");
});

test("a successful save posts the whole record and disarms the button", async () => {
    initLayer1Dom();
    const route = stubSettingsRoute(null, true);
    attachSettingsSave();
    getInputById("dir").value = SAVED_PROJECT.dir;
    getInputById("repo").value = SAVED_PROJECT.repo;
    markSettingsDirty();

    getRequiredElementById("save-settings").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();

    assert.equal(route.posted().length, 1);
    assert.deepEqual(Object.keys(route.posted()[0] as object).sort(),
        ["branch", "dir", "fileHistory", "jsonl", "ref", "repo"]);
    assert.equal(isSaveButtonDisabled(), true);
    assert.equal(getRequiredElementById("saved-note").textContent, "saved");
});

test("a refused save leaves the button armed and says so", async () => {
    initLayer1Dom();
    stubSettingsRoute(null, false);
    attachSettingsSave();
    markSettingsDirty();

    getRequiredElementById("save-settings").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();

    assert.equal(isSaveButtonDisabled(), false);
    assert.match(getRequiredElementById("saved-note").textContent ?? "", /save failed/);
});

test("saving folder collapse state posts dir and the folder list", async () => {
    initLayer1Dom();
    const route = stubSettingsRoute(null, true);
    getInputById("dir").value = SAVED_PROJECT.dir;

    saveFolderCollapseState(["src/a", "src/b"]);
    await settle();

    assert.deepEqual(route.posted(), [{ dir: SAVED_PROJECT.dir, collapsedFolders: ["src/a", "src/b"] }]);
});

test("saving folder collapse state with no project open posts nothing", async () => {
    initLayer1Dom();
    const route = stubSettingsRoute(null, true);
    getInputById("dir").value = "";

    saveFolderCollapseState(["src/a"]);
    await settle();

    assert.deepEqual(route.posted(), []);
});
