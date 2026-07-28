// Tests for item 46: the file-history dir override, per-project path overrides (reveng-paths.json), and the override-aware built-document cache key.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDocumentWithConsent } from "../src/viewer_api.ts";
import {
    setProjectsDir,
    setFileHistoryDir,
    getEffectiveFileHistoryDir,
    getMergedProjectPaths,
    applyProjectOverrides,
    setSessionProjectPaths,
} from "../src/viewer_api_projects.ts";
import {
    getPathOverrides,
    setPathOverrides,
    PROJECT_PATHS_CONFIG_NAME,
} from "../src/reconstruction_overrides.ts";
import { Path } from "../src/structures/domain.ts";
import { S19_JSONL } from "./fixtures.ts";

// -------------------- item 46: file-history dir + per-project path overrides --------------------

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

test("test_effective_file_history_dir_derives_sibling_of_projects_dir", () => {
    // Scenario: a copied claude-data tree has file-history/ sitting next to projects/; with no explicit override the viewer serves that sibling.
    const treeRoot = mkdtempSync(join(tmpdir(), "reveng-fhs-derive-"));
    try {
        // Steps: build <X>/projects and <X>/file-history, switch the scan root to <X>/projects.
        mkdirSync(join(treeRoot, "projects"));
        mkdirSync(join(treeRoot, "file-history"));
        setProjectsDir(join(treeRoot, "projects"));
        // assert the effective file-history dir is the derived sibling.
        assert.equal(getEffectiveFileHistoryDir().toString(), join(treeRoot, "file-history"));
    } finally {
        rmSync(treeRoot, { recursive: true, force: true });
    }
});

test("test_set_file_history_dir_override_wins_then_clears_on_projects_switch", () => {
    // Scenario: an explicit file-history dir beats the sibling derivation; "" clears it; and switching the projects folder clears it too (the webapp prepopulate behavior).
    const treeRoot = mkdtempSync(join(tmpdir(), "reveng-fhs-override-"));
    try {
        mkdirSync(join(treeRoot, "projects"));
        mkdirSync(join(treeRoot, "file-history"));
        mkdirSync(join(treeRoot, "explicit"));
        setProjectsDir(join(treeRoot, "projects"));
        // Step: an explicit override wins over the sibling derivation.
        setFileHistoryDir(join(treeRoot, "explicit"));
        assert.equal(getEffectiveFileHistoryDir().toString(), join(treeRoot, "explicit"));
        // Step: a non-directory throws and leaves the override in place.
        assert.throws(() => setFileHistoryDir("/nonexistent/definitely/not/a/dir"));
        assert.equal(getEffectiveFileHistoryDir().toString(), join(treeRoot, "explicit"));
        // Step: the empty string clears the override — back to the derived sibling.
        setFileHistoryDir("");
        assert.equal(getEffectiveFileHistoryDir().toString(), join(treeRoot, "file-history"));
        // Step: an override set before a projects-folder switch clears with the switch.
        setFileHistoryDir(join(treeRoot, "explicit"));
        setProjectsDir(join(treeRoot, "projects"));
        assert.equal(getEffectiveFileHistoryDir().toString(), join(treeRoot, "file-history"));
    } finally {
        rmSync(treeRoot, { recursive: true, force: true });
    }
});

test("test_apply_project_overrides_reads_config_entry_and_effective_fhs_root", () => {
    // Scenario: each project-scoped request applies its reveng-paths.json entry plus the effective file-history root; a project without an entry keeps only the root.
    const treeRoot = mkdtempSync(join(tmpdir(), "reveng-apply-"));
    try {
        // Steps: a projects dir with a config entry for project "p" and a file-history sibling.
        mkdirSync(join(treeRoot, "projects"));
        mkdirSync(join(treeRoot, "file-history"));
        const wireConfig = { p: { cwd: "/original/p", repo: "/repos/p", baseCommit: "deadbeef" } };
        writeFileSync(join(treeRoot, "projects", PROJECT_PATHS_CONFIG_NAME), JSON.stringify(wireConfig));
        setProjectsDir(join(treeRoot, "projects"));
        // Step: applying project "p" hydrates its entry and stamps the effective FHS root.
        applyProjectOverrides("p");
        assert.equal(getPathOverrides().projectCwd?.toString(), "/original/p");
        assert.equal(getPathOverrides().repoDir?.toString(), "/repos/p");
        assert.equal(getPathOverrides().baseCommit?.toString(), "deadbeef");
        assert.equal(getPathOverrides().fileHistoryRoot?.toString(), join(treeRoot, "file-history"));
        // Step: applying a project with no entry drops the per-project fields, keeps the root.
        applyProjectOverrides("other");
        assert.equal(getPathOverrides().projectCwd, undefined);
        assert.equal(getPathOverrides().repoDir, undefined);
        assert.equal(getPathOverrides().baseCommit, undefined);
        assert.equal(getPathOverrides().fileHistoryRoot?.toString(), join(treeRoot, "file-history"));
    } finally {
        rmSync(treeRoot, { recursive: true, force: true });
    }
});

test("test_session_project_paths_merge_over_stored_entry", () => {
    // Scenario (task 137): "apply to session" overrides merge field-wise over the stored reveng-paths.json entry — a session field wins over the same stored field, stored fields absent from the session entry survive, and a per-project fileHistory beats the derived root.
    const treeRoot = mkdtempSync(join(tmpdir(), "reveng-session-"));
    try {
        // Steps: a projects dir whose config stores repo + baseCommit for project "p".
        mkdirSync(join(treeRoot, "projects"));
        mkdirSync(join(treeRoot, "file-history"));
        writeFileSync(join(treeRoot, "projects", PROJECT_PATHS_CONFIG_NAME), JSON.stringify({
            p: { repo: "/repos/from-file", baseCommit: "aaaa1111" },
        }));
        setProjectsDir(join(treeRoot, "projects"));
        // Step: a session entry supplies a new baseCommit and an explicit fileHistory.
        setSessionProjectPaths("p", { baseCommit: "bbbb2222", fileHistory: "/tmp/session-history" });
        // the merged wire entry shows session fields winning, stored fields surviving.
        assert.deepEqual(getMergedProjectPaths("p"), {
            repo: "/repos/from-file",
            baseCommit: "bbbb2222",
            fileHistory: "/tmp/session-history",
        });
        // Step: applying the project stamps the merged overrides into the engine.
        applyProjectOverrides("p");
        assert.equal(getPathOverrides().repoDir?.toString(), "/repos/from-file");
        assert.equal(getPathOverrides().baseCommit?.toString(), "bbbb2222");
        // the per-project fileHistory wins over the derived sibling root.
        assert.equal(getPathOverrides().fileHistoryRoot?.toString(), "/tmp/session-history");
        // Step: a project with no session entry still gets the derived root (regression guard).
        applyProjectOverrides("other");
        assert.equal(getPathOverrides().fileHistoryRoot?.toString(), join(treeRoot, "file-history"));
    } finally {
        setSessionProjectPaths("p", {});
        rmSync(treeRoot, { recursive: true, force: true });
    }
});

test("test_document_cache_key_includes_override_serialization", () => {
    // Scenario: a config-file edit between requests must never serve a stale cached document — the built-document cache key carries the serialized overrides.  Step: build once with empty overrides (allowScripts false keeps the build pure).
    setPathOverrides({});
    const firstDocument = buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false);
    // Step: a repeat with unchanged overrides returns the SAME cached object.
    assert.strictEqual(buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false), firstDocument);
    // Step: changing an override misses the cache — a fresh document object is built.
    setPathOverrides({ projectCwd: new Path("/somewhere/else") });
    assert.notStrictEqual(buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false), firstDocument);
});
