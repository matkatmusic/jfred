// Task 360: the show row's boxes save per project and restore from saved settings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { VIEW, readHiddenKinds, stubSettingsRoute, toggleBox } from "./layer1-kind-filter-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { loadSavedSettings } = await import("../webapp/layer1-settings-restore.ts");

async function renderFreshView(dir: string = ""): Promise<void> {
    initLayer1Dom();
    getInputById("dir").value = dir;
    await renderLayer1View(VIEW);
}

test("test_the_edit_box_starts_unchecked_and_is_never_saved_as_hidden", async () => {
    const route = stubSettingsRoute(null);
    await renderFreshView("/tmp/edit-app");
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!.checked, false);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=script-run]")!.checked, false);
    toggleBox("commit", false);
    assert.deepEqual(route.posted(), [{ dir: "/tmp/edit-app", hiddenKinds: ["commit"] }]);
});

test("test_the_boxes_restore_from_saved_settings", async () => {
    const dir = "/tmp/restore-app";
    initLayer1Dom();
    stubSettingsRoute({ lastDir: dir, projects: { [dir]: { dir, hiddenKinds: ["snapshot"] } } });
    await loadSavedSettings();
    await renderLayer1View(VIEW);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=snapshot]")!.checked, false);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=commit]")!.checked, true);
    assert.equal(readHiddenKinds(), "snapshot edit script-run branch");
});

test("test_toggling_a_box_posts_dir_and_hidden_kinds", async () => {
    const route = stubSettingsRoute(null);
    await renderFreshView("/tmp/post-app");
    toggleBox("commit", false);
    assert.deepEqual(route.posted(), [{ dir: "/tmp/post-app", hiddenKinds: ["commit"] }]);
    await renderFreshView("");
    toggleBox("commit", false);
    assert.equal(route.posted().length, 1);
});

test("test_the_branch_box_starts_unchecked_and_is_never_saved_as_hidden", async () => {
    const route = stubSettingsRoute(null);
    await renderFreshView("/tmp/branch-app");
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=branch]")!.checked, false);
    toggleBox("commit", false);
    assert.deepEqual(route.posted(), [{ dir: "/tmp/branch-app", hiddenKinds: ["commit"] }]);
});

test("test_the_url_never_carries_a_kinds_parameter", async () => {
    stubSettingsRoute(null);
    await renderFreshView();
    toggleBox("snapshot", false);
    assert.ok(!location.search.includes("kinds"));
});
