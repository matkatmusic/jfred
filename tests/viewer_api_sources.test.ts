// Spec S6 (task 177) server side: a project entry declaring `sources` serves the union of every
// source's project JSONLs; entries without `sources` keep the single-dir scan (pinned).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setProjectsDir, setSessionProjectPaths } from "../src/viewer_api_projects.ts";
import { resolveJsonlPaths } from "../src/viewer_api_sources.ts";
import { makeSourceTree } from "./multi-source-test-helpers.ts";

const PROJECT_NAME = "-viewer-sources-proj";

// Server-side module state — never let one test's state leak into the next.
afterEach(() => {
    setSessionProjectPaths(PROJECT_NAME, {});
    setPathOverrides({});
});

// Two source trees, each holding one JSONL for its own project dir; the active dir is tree A.
function makeTwoTreeServerFixture(): { jsonlA: string; jsonlB: string; treeAProjects: string; treeBProjects: string } {
    const treeA = makeSourceTree(PROJECT_NAME);
    const treeB = makeSourceTree("-viewer-sources-other");
    const jsonlA = join(treeA.projectDir, "a.jsonl");
    const jsonlB = join(treeB.projectDir, "b.jsonl");
    writeFileSync(jsonlA, `${JSON.stringify({ type: "aiTitle", sessionId: "aaaa", aiTitle: "t" })}\n`);
    writeFileSync(jsonlB, `${JSON.stringify({ type: "aiTitle", sessionId: "bbbb", aiTitle: "t" })}\n`);
    const treeAProjects = join(treeA.treeRoot, "projects");
    const treeBProjects = join(treeB.treeRoot, "projects");
    setProjectsDir(treeAProjects);
    // resolveProjectFile realpaths at the trust boundary, so expectations must too (the macOS
    // temp dir is a /var -> /private/var symlink).
    return { jsonlA: realpathSync(jsonlA), jsonlB: realpathSync(jsonlB), treeAProjects, treeBProjects };
}

test("test_resolve_jsonl_paths_unions_configured_sources", () => {
    // Scenario (spec S6): with a session paths entry declaring two sources, the unified
    // project view serves the JSONLs of BOTH source trees.
    // Step: two trees, one jsonl each; the session entry lists both projects roots.
    const fixture = makeTwoTreeServerFixture();
    setSessionProjectPaths(PROJECT_NAME, {
        sources: [{ projectsDir: fixture.treeAProjects }, { projectsDir: fixture.treeBProjects }],
    });
    // Test action: resolve the unified (no jsonl name) path set.
    const resolved = resolveJsonlPaths(PROJECT_NAME, null).map((path) => path.toString());
    // Test verification: both trees' jsonls are served.
    assert.ok(resolved.includes(fixture.jsonlA));
    assert.ok(resolved.includes(fixture.jsonlB));
});

test("test_resolve_jsonl_paths_without_sources_scans_single_dir", () => {
    // Scenario (legacy pin): without a `sources` entry, only the active projects dir's
    // project files are served — the pre-S6 behavior, byte for byte.
    const fixture = makeTwoTreeServerFixture();
    const resolved = resolveJsonlPaths(PROJECT_NAME, null).map((path) => path.toString());
    assert.deepEqual(resolved, [fixture.jsonlA]);
});
