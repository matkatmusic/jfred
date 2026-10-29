// Spec S5a §b: per-session workspace-root resolution.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceEntry } from "../src/reconstruction_overrides.ts";
import { computeSessionRoots } from "../src/reconstruction_multi_source_roots.ts";
import { SESSION_A, createTwoSourceEditFixture } from "./multi-source-test-helpers.ts";

test("test_session_root_uses_declared_source_root_over_cwd", () => {
    // Scenario (§b3): a source entry declaring a root wins over the session's recorded cwd.
    const fixture = createTwoSourceEditFixture("line one\n");
    const roots = computeSessionRoots(fixture.listA, fixture.sources);
    // Test verification: the declared root, not the cwd, is the session's root.
    assert.equal(roots.get(SESSION_A)?.toString(), fixture.sources[0]!.root!.toString());
});

test("test_session_root_auto_detects_from_first_cwd_when_source_declares_none", () => {
    // Scenario (§b2): with no declared root, the session's first recorded cwd is the root.
    const fixture = createTwoSourceEditFixture("line one\n");
    const rootlessSources: SourceEntry[] = [{ projectsDir: fixture.sources[0]!.projectsDir }];
    const roots = computeSessionRoots(fixture.listA, rootlessSources);
    // Test verification: auto-detect lands on the fixture's recorded cwd (workspace-alpha).
    assert.equal(roots.get(SESSION_A)?.toString(), fixture.rootA);
});
