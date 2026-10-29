import assert from "node:assert/strict";
import { test } from "node:test";
import { PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX } from "../src/reconstruction_script_sandbox.ts";
import { reportReconstructionProgress } from "../src/reconstruction_progress.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { buildToolRecord, collectSandboxSpawnLabels } from "./script-execution-test-helpers.ts";

test("buildToolRecord builds an assistant record with one tool_use block", () => {
  const record = buildToolRecord(ToolName.Bash, { command: "ls" }, "2026-01-01T00:00:00.000Z", "/work");
  const content = (record as unknown as { message: { content: [{ type: BlockType; name: ToolName }] } }).message.content;
  assert.equal(record.type, RecordType.assistant);
  assert.equal(content.length, 1);
  assert.equal(content[0].type, BlockType.tool_use);
  assert.equal(content[0].name, ToolName.Bash);
  assert.equal(String(record.cwd), "/work");
});

test("buildToolRecord leaves cwd undefined when none is given", () => {
  const record = buildToolRecord(ToolName.Bash, {}, "2026-01-01T00:00:00.000Z");
  assert.equal(record.cwd, undefined);
});

test("collectSandboxSpawnLabels keeps only sandbox spawn labels", () => {
  const spawnLabel = `${PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX} (0 seeded files)`;
  function reportTwoLabels(): void {
    reportReconstructionProgress("something else");
    reportReconstructionProgress(spawnLabel);
  }
  assert.deepEqual(collectSandboxSpawnLabels(reportTwoLabels), [spawnLabel]);
});
