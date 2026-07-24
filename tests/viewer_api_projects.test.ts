// Static-request path mapping (task 204): `/` and `/webapp_old.html` both serve the preserved
// pre-redesign page; `/app/*` strips to plain asset names resolved dist-first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { computeStaticFileRelative, resolveStaticFilePath } from "../src/viewer_api_projects.ts";

const WEBAPP_DIR = resolve(import.meta.dirname, "..", "webapp");
const WEBAPP_DIST_DIR = resolve(WEBAPP_DIR, "dist");

test("root_maps_to_webapp_old_until_layered_page_lands", () => {
    assert.equal(computeStaticFileRelative("/"), "webapp_old.html");
});

test("webapp_old_path_maps_to_webapp_old_file", () => {
    assert.equal(computeStaticFileRelative("/webapp_old.html"), "webapp_old.html");
});

test("app_prefixed_assets_strip_to_plain_names", () => {
    assert.equal(computeStaticFileRelative("/app/styles.css"), "styles.css");
    assert.equal(computeStaticFileRelative("/app/vendor/xterm.js"), "vendor/xterm.js");
});

test("webapp_old_resolves_to_existing_source_file", () => {
    const resolved = resolveStaticFilePath("webapp_old.html", WEBAPP_DIST_DIR, WEBAPP_DIR);
    assert.equal(resolved, resolve(WEBAPP_DIR, "webapp_old.html"));
    assert.ok(existsSync(resolved));
});
