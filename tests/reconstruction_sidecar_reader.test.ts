// Item 46: file-history-root resolution — sibling derivation, override precedence, default fallback.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { getPathOverrides, setPathOverrides } from "../src/reconstruction_overrides.ts";
import {
    findFileHistoryRootFromRecords,
    findSiblingFileHistoryRoot,
    getDefaultFileHistoryRoot,
    getFileHistoryRoot,
    getProjectsDirOfLog,
} from "../src/reconstruction_sidecar_reader.ts";
import { createCopiedTree, loadMinimalTranscript } from "./sidecar-reader-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

test("test_derive_sibling_file_history_root_finds_existing_sibling", () => {
    // A tree copied out of ~/.claude keeps file-history as a sibling of projects.
    const { treeRoot } = createCopiedTree(true);
    const derived = findSiblingFileHistoryRoot(new Path(join(treeRoot, "projects")));
    assert.equal(derived?.toString(), join(treeRoot, "file-history"));
});

test("test_derive_sibling_file_history_root_returns_undefined_without_sibling", () => {
    // No sibling means no derived root, so the resolution chain moves on to the default.
    const { treeRoot } = createCopiedTree(false);
    assert.equal(findSiblingFileHistoryRoot(new Path(join(treeRoot, "projects"))), undefined);
});

test("test_resolve_file_history_root_prefers_override_over_derivation", () => {
    // An explicit fileHistoryRoot override outranks the transcript-derived sibling.
    const { treeRoot, projectDir } = createCopiedTree(true);
    const records = loadMinimalTranscript(projectDir, "session.jsonl");
    assert.equal(findFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
    setPathOverrides({ fileHistoryRoot: new Path("/tmp/override-file-history") });
    assert.equal(getFileHistoryRoot(records, getPathOverrides()).toString(), "/tmp/override-file-history");
});

test("test_getProjectsDirOfLog_gives_projects_folder_for_a_subagent_log", () => {
    const logPath = new Path("/cd/projects/proj/sid/subagents/agent-x.jsonl");
    assert.equal(getProjectsDirOfLog(logPath).toString(), "/cd/projects");
});

test("test_getProjectsDirOfLog_gives_projects_folder_for_a_flat_log", () => {
    const logPath = new Path("/cd/projects/proj/sid.jsonl");
    assert.equal(getProjectsDirOfLog(logPath).toString(), "/cd/projects");
});

test("test_subagent_log_finds_file_history_beside_the_projects_folder", () => {
    // A subagent log sits at <proj>/<sessionId>/subagents; its history root is still <X>/file-history.
    const { treeRoot, projectDir } = createCopiedTree(true);
    const subagentsDir = join(projectDir, "11111111-2222-3333-4444-555555555555", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    const records = loadMinimalTranscript(subagentsDir, "agent-x.jsonl");
    assert.equal(findFileHistoryRootFromRecords(records)?.toString(), join(treeRoot, "file-history"));
});

test("test_getFileHistoryRoot_returns_the_passed_root", () => {
    // Scenario: the shared setting names another folder; the root passed in is the one returned.
    const { projectDir } = createCopiedTree(true);
    const records = loadMinimalTranscript(projectDir, "session.jsonl");
    setPathOverrides({ fileHistoryRoot: new Path("/tmp/shared-setting-file-history") });
    // Test action: ask with a different folder than the shared setting holds.
    const passedOverrides = { fileHistoryRoot: new Path("/tmp/passed-file-history") };
    // Test verification: the passed folder wins.
    assert.equal(getFileHistoryRoot(records, passedOverrides).toString(), "/tmp/passed-file-history");
});

test("test_resolve_file_history_root_falls_back_to_default_without_source_or_override", () => {
    // Records that never went through loadTranscript carry no source to derive from.
    const records = [{ type: RecordType.aiTitle } as unknown as TranscriptRecord];
    assert.equal(getFileHistoryRoot(records, getPathOverrides()).toString(), getDefaultFileHistoryRoot().toString());
});
