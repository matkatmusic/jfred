// listTranscriptFiles keeps chat and subagent transcripts and skips the Workflow tool's journal.jsonl files.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { listSourceFilesUnder, listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { Path } from "../src/structures/domain.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
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

test("test_list_transcript_files_skips_prompt_history", () => {
    const folder = createTempDir();
    writeFileSync(join(folder, "a.jsonl"), "{}\n");
    writeFileSync(join(folder, "history.jsonl"), '{"display":"hi","timestamp":1,"project":"/p","sessionId":"s"}\n');
    const names = listTranscriptFiles([folder]).map((path) => basename(path.toString()));
    assert.deepEqual(names, ["a.jsonl"]);
});

test("test_list_source_files_leaves_out_zero_byte_jsonl", () => {
    // A subagent that never wrote a record leaves a zero-byte transcript; a non-empty one next to it stays.
    const folder = createTempDir();
    writeFileSync(join(folder, "agent-empty.jsonl"), "");
    writeFileSync(join(folder, "agent-full.jsonl"), "{}\n");
    const names = listSourceFilesUnder(new Path(folder), SourceKind.jsonl).map((path) => basename(path.toString()));
    assert.deepEqual(names, ["agent-full.jsonl"]);
});

test("test_listSourceFilesUnder_skips_the_claude_hooks_folder", () => {
    // A root holds a real transcript a.jsonl and a hook debug log at .claude_hooks/debug/b.jsonl.
    const folder = createTempDir();
    const hookLogFolder = join(folder, ".claude_hooks", "debug");
    mkdirSync(hookLogFolder, { recursive: true });
    writeFileSync(join(folder, "a.jsonl"), "{}\n");
    writeFileSync(join(hookLogFolder, "b.jsonl"), "{}\n");
    // Listing with SourceKind.jsonl finds only a.jsonl.
    const names = listSourceFilesUnder(new Path(folder), SourceKind.jsonl).map((path) => basename(path.toString()));
    assert.deepEqual(names, ["a.jsonl"]);
});

test("test_list_source_files_keeps_zero_byte_file_history_file", () => {
    // File-history snapshots may legitimately be empty files.
    const folder = createTempDir();
    writeFileSync(join(folder, "abc123@v1"), "");
    const names = listSourceFilesUnder(new Path(folder), SourceKind.fileHistory).map((path) => basename(path.toString()));
    assert.deepEqual(names, ["abc123@v1"]);
});
