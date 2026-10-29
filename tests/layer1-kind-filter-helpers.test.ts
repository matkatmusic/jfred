import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildFreshView, installSettingsRoute, readHiddenKinds, toggleBox } from "./layer1-kind-filter-helpers.ts";

test("test_build_fresh_view_returns_a_new_empty_view_each_call", () => {
    const first = buildFreshView() as { pairs: unknown[] };
    assert.deepEqual(first.pairs, []);
    assert.notEqual(first, buildFreshView());
});

test("test_install_settings_route_records_posted_bodies_and_returns_the_saved_file", async () => {
    const route = installSettingsRoute({ lastDir: "/x" });
    const getResponse = await fetch("/api/settings");
    assert.deepEqual(await getResponse.json(), { lastDir: "/x" });
    assert.deepEqual(route.posted(), []);
    await fetch("/api/settings", { method: "POST", body: JSON.stringify({ a: 1 }) });
    assert.deepEqual(route.posted(), [{ a: 1 }]);
});

test("test_toggle_box_sets_checked_and_fires_change", () => {
    initLayer1Dom();
    document.body.innerHTML = `<div id="show-row"><input type="checkbox" data-kind="commit" checked></div><div class="viz-root" data-hidden-kinds="a b"></div>`;
    let changes = 0;
    document.querySelector("#show-row [data-kind=commit]")!.addEventListener("change", () => {
        changes++;
    });
    toggleBox("commit", false);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=commit]")!.checked, false);
    assert.equal(changes, 1);
    assert.equal(readHiddenKinds(), "a b");
});
