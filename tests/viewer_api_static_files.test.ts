import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeStaticFileRelative, findStaticFilePath } from "../src/viewer_api_static_files.ts";

test("test_computeStaticFileRelative_maps_root_and_strips_app_prefix", () => {
    assert.equal(computeStaticFileRelative("/"), "index.html");
    assert.equal(computeStaticFileRelative("/app/styles.css"), "styles.css");
    assert.equal(computeStaticFileRelative("/webapp_old.html"), "webapp_old.html");
});

test("test_findStaticFilePath_prefers_dist_then_falls_back_to_webapp", () => {
    const root = mkdtempSync(join(tmpdir(), "reveng-static-files-"));
    const distDir = join(root, "dist");
    const webappDir = join(root, "webapp");
    mkdirSync(distDir);
    mkdirSync(webappDir);
    writeFileSync(join(distDir, "app.js"), "");
    assert.equal(findStaticFilePath("app.js", distDir, webappDir), join(distDir, "app.js"));
    assert.equal(findStaticFilePath("styles.css", distDir, webappDir), join(webappDir, "styles.css"));
});
