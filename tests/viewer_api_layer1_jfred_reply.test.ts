// Task 361 gap 606: a jfred Commit includes a recorded script run only when the page allowed scripts.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { clearBuiltDocumentCache } from "../src/viewer_api.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { parseCommitInput } from "../src/viewer_api_layer1_jfred_route.ts";
import { buildCommitReply } from "../src/viewer_api_layer1_jfred_reply.ts";
import { JFRED_SUBJECT_PREFIX, JfredCommitOutcome } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";
import { resetRunState } from "./layer1_run_test_helpers.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";

const WRITE_AT = "2026-07-01T17:00:00.000Z";
const SCRIPT_AT = "2026-07-01T18:00:00.000Z";
const MARK_AT = "2026-07-01T20:00:00.000Z";
const APPEND_Z_SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "z\\n")\n';

// One Write of a.txt, then a recorded script run that appends a line to it.
function createScriptFixture() {
    const { repoDir, commitHashes } = createJfredTempRepo();
    const tree = createSourceTree("-jfred-reply-script");
    const envelope = { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp: WRITE_AT, toolId: "toolu_w0", parentUuid: null };
    const write = buildWriteRecordPair(envelope, join(tree.treeRoot, "a.txt"), "first text\n");
    const block = { type: "tool_use", id: "toolu_script", name: ToolName.CtxExecute, input: { cwd: tree.treeRoot, code: APPEND_Z_SCRIPT } };
    const scriptRecord = { sessionId: SESSION_A, timestamp: SCRIPT_AT, cwd: tree.treeRoot, type: "assistant", uuid: "toolu_script-a", parentUuid: null, message: { role: "assistant", content: [block] } };
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...write.records, scriptRecord]);
    clearBuiltDocumentCache();
    return { repoDir, baseShortHash: commitHashes[1]!.slice(0, 8), projectDir: tree.treeRoot, transcriptFolder: tree.projectDir };
}

function buildInputBody(baseShortHash: string, allowScripts?: unknown): string {
    return JSON.stringify({ baseShortHash, markInstant: MARK_AT, message: `${JFRED_SUBJECT_PREFIX}${MARK_AT}`, allowScripts });
}

function commitScriptFixture(allowScripts: boolean): string {
    resetRunState();
    const fixture = createScriptFixture();
    const query = new URLSearchParams({ dir: fixture.projectDir, repo: fixture.repoDir, jsonl: fixture.transcriptFolder });
    const reply = buildCommitReply(parseCommitInput(query, buildInputBody(fixture.baseShortHash, allowScripts)), () => {});
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    return execFileSync("git", ["show", "jfred:a.txt"], { cwd: fixture.repoDir, encoding: "utf8" });
}

test("test_commit_with_consent_includes_the_script_change", () => {
    // Scenario: scripts are allowed, so the commit holds the line the script appended.
    assert.equal(commitScriptFixture(true), "first text\nz\n");
});

test("test_commit_without_consent_leaves_the_script_change_out", () => {
    // Scenario: scripts are not allowed, so the commit holds only the Write's text.
    assert.equal(commitScriptFixture(false), "first text\n");
});

test("test_parseCommitInput_refuses_a_request_without_a_boolean_allowScripts", () => {
    // Scenario: a missing or non-boolean allowScripts is refused with an error naming the field.
    const query = new URLSearchParams({ dir: process.cwd(), repo: process.cwd() });
    assert.throws(() => parseCommitInput(query, buildInputBody("a1b2c3d4")), /allowScripts/);
    assert.throws(() => parseCommitInput(query, buildInputBody("a1b2c3d4", "yes")), /allowScripts/);
});
