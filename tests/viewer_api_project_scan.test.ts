import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path } from "../src/structures/domain.ts";
import { ROOT_PROJECT_NAME, listSubagentTranscripts, scanProjects } from "../src/viewer_api_project_scan.ts";

test("test_scanProjects_lists_loose_jsonl_files_as_root_project", () => {
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-scan-root-"));
    mkdirSync(join(projectsDir, "alpha"));
    writeFileSync(join(projectsDir, "loose.jsonl"), "{}\n");
    const listings = scanProjects(new Path(projectsDir));
    const names = [];
    for (const listing of listings) {
        names.push(listing.name);
    }
    assert.deepEqual(names.sort(), ["alpha", ROOT_PROJECT_NAME].sort());
});

test("test_listSubagentTranscripts_keeps_only_agent_jsonl_files", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "reveng-scan-subagents-"));
    const subagentsDir = join(projectDir, "session-a", "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(subagentsDir, "agent-foo.jsonl"), "");
    writeFileSync(join(subagentsDir, "notes.txt"), "");
    const entries = listSubagentTranscripts(projectDir, "session-a");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.fileName.toString(), join("session-a", "subagents", "agent-foo.jsonl"));
});
