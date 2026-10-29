import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findStaticFilePath } from "../src/viewer_api_static_files.ts";

// Two sibling roots mirroring webapp/dist (compiled JS) and webapp/ (source assets).
function buildStaticRoots(): { distDir: string; webappDir: string } {
    const root = mkdtempSync(join(tmpdir(), "viewer-static-"));
    const distDir = join(root, "dist");
    const webappDir = join(root, "webapp");
    mkdirSync(distDir);
    mkdirSync(webappDir);
    return { distDir, webappDir };
}

test("test_findStaticFilePath_prefers_the_compiled_dist_copy", () => {
    // Scenario: a .js request resolves to the compiled dist copy when the build emitted it.
    const { distDir, webappDir } = buildStaticRoots();
    writeFileSync(join(distDir, "app.js"), "compiled");
    assert.equal(findStaticFilePath("app.js", distDir, webappDir), join(distDir, "app.js"));
});

test("test_findStaticFilePath_falls_back_to_the_webapp_source", () => {
    // Scenario: files the build never emits, like styles.css, fall back to the webapp source root.
    const { distDir, webappDir } = buildStaticRoots();
    writeFileSync(join(webappDir, "styles.css"), "body {}");
    assert.equal(findStaticFilePath("styles.css", distDir, webappDir), join(webappDir, "styles.css"));
});

