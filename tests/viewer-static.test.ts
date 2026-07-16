import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStaticFilePath } from "../src/viewer_api_projects.ts";

// Two sibling roots mirroring webapp/dist (compiled JS) and webapp/ (source assets).
function buildStaticRoots(): { distDir: string; webappDir: string } {
    const root = mkdtempSync(join(tmpdir(), "viewer-static-"));
    const distDir = join(root, "dist");
    const webappDir = join(root, "webapp");
    mkdirSync(distDir);
    mkdirSync(webappDir);
    return { distDir, webappDir };
}

test("test_resolveStaticFilePath_prefers_the_compiled_dist_copy", () => {
    // Scenario: a .js request resolves to the compiled webapp/dist copy when the build
    // emitted that file, so the browser loads transpiled output, not TypeScript source.
    // Steps:
    // a compiled app.js exists only in the dist root.
    const { distDir, webappDir } = buildStaticRoots();
    writeFileSync(join(distDir, "app.js"), "compiled");
    // resolving app.js must pick the dist copy.
    assert.equal(resolveStaticFilePath("app.js", distDir, webappDir), join(distDir, "app.js"));
});

test("test_resolveStaticFilePath_falls_back_to_the_webapp_source", () => {
    // Scenario: index.html, styles.css, and vendor/*.js are never emitted by the build, so
    // requests for them must fall back to the webapp source root.
    // Steps:
    // styles.css exists only in the webapp root.
    const { distDir, webappDir } = buildStaticRoots();
    writeFileSync(join(webappDir, "styles.css"), "body {}");
    // resolving styles.css must pick the webapp copy.
    assert.equal(resolveStaticFilePath("styles.css", distDir, webappDir), join(webappDir, "styles.css"));
});

