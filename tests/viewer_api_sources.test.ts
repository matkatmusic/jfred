// Spec S6 (task 177): a project entry with `sources` serves the union of its source JSONLs.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setProjectsDir, setSessionProjectPaths } from "../src/viewer_api_projects.ts";
import { findJsonlPaths } from "../src/viewer_api_sources.ts";
import { makeSourceTree } from "./multi-source-test-helpers.ts";

const PROJECT_NAME = "-viewer-sources-proj";

// Reset server module state so no test leaks into the next.
afterEach(() => {
    setSessionProjectPaths(PROJECT_NAME, {});
    setPathOverrides({});
});

// Two source trees with one JSONL each; the active dir is tree A.
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
    // findProjectFile resolves realpaths, and the macOS temp dir is a symlink.
    return { jsonlA: realpathSync(jsonlA), jsonlB: realpathSync(jsonlB), treeAProjects, treeBProjects };
}

test("test_resolve_jsonl_paths_unions_configured_sources", () => {
    // Scenario (spec S6): a session entry with two sources serves the JSONLs of both trees.
    const fixture = makeTwoTreeServerFixture();
    setSessionProjectPaths(PROJECT_NAME, {
        sources: [{ projectsDir: fixture.treeAProjects }, { projectsDir: fixture.treeBProjects }],
    });
    const resolved = findJsonlPaths(PROJECT_NAME, null).map((path) => path.toString());
    assert.ok(resolved.includes(fixture.jsonlA));
    assert.ok(resolved.includes(fixture.jsonlB));
});

test("test_resolve_jsonl_paths_without_sources_scans_single_dir", () => {
    // Scenario (legacy pin): without `sources`, only the active projects dir is served.
    const fixture = makeTwoTreeServerFixture();
    const resolved = findJsonlPaths(PROJECT_NAME, null).map((path) => path.toString());
    assert.deepEqual(resolved, [fixture.jsonlA]);
});
