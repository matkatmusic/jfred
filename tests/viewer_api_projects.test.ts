// Static-request path mapping (task 204): root/webapp_old serve pre-redesign pages; `/app/*` strips to dist-first asset names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { computeStaticFileRelative, listSubagentTranscripts, resolveStaticFilePath } from "../src/viewer_api_projects.ts";

const WEBAPP_DIR = resolve(import.meta.dirname, "..", "webapp");
const WEBAPP_DIST_DIR = resolve(WEBAPP_DIR, "dist");

test("test_root_maps_to_layered_index_page", () => {
    // Scenario (task 205): the layered page claimed index.html as the app's main page.
    assert.equal(computeStaticFileRelative("/"), "index.html");
});

test("test_layered_index_resolves_to_existing_source_file", () => {
    // Scenario (task 205): the served root page actually exists in webapp/.
    const resolved = resolveStaticFilePath("index.html", WEBAPP_DIST_DIR, WEBAPP_DIR);
    assert.equal(resolved, resolve(WEBAPP_DIR, "index.html"));
    assert.ok(existsSync(resolved));
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

test("listSubagentTranscripts_returns_empty_when_subagents_dir_missing", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "reveng-subagents-"));
    assert.deepEqual(listSubagentTranscripts(projectDir, "session-a"), []);
});

test("listSubagentTranscripts_finds_only_agent_jsonl_files", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "reveng-subagents-"));
    const subagentsDir = join(projectDir, "session-a", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, "agent-foo.jsonl"), "");
    writeFileSync(join(subagentsDir, "notes.txt"), "");
    const entries = listSubagentTranscripts(projectDir, "session-a");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.fileName.toString(), join("session-a", "subagents", "agent-foo.jsonl"));
});

test("listSubagentTranscripts_ignores_loose_files_outside_subagents_dir", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "reveng-subagents-"));
    mkdirSync(join(projectDir, "session-a"), { recursive: true });
    writeFileSync(join(projectDir, "session-a", "agent-foo.jsonl"), "");
    assert.deepEqual(listSubagentTranscripts(projectDir, "session-a"), []);
});
