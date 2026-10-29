// listTranscriptFiles keeps chat and subagent transcripts and skips the Workflow tool's journal.jsonl files.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

test("test_list_transcript_files_skips_workflow_journal", () => {
    const folder = createTempDir();
    const workflowFolder = join(folder, "subagents", "workflows", "wf_x");
    mkdirSync(workflowFolder, { recursive: true });
    writeFileSync(join(folder, "subagents", "agent-a1.jsonl"), "{}\n");
    writeFileSync(join(workflowFolder, "agent-a2.jsonl"), "{}\n");
    writeFileSync(join(workflowFolder, "journal.jsonl"), '{"type":"launched"}\n');
    const names = listTranscriptFiles([folder]).map((path) => basename(path.toString())).sort();
    assert.deepEqual(names, ["agent-a1.jsonl", "agent-a2.jsonl"]);
});
