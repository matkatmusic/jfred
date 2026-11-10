import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { PLAYGROUND_HISTORY_CONTENT, writeUntrackedStartFiles } from "./engineV3_replay_start_files.ts";

test("writeUntrackedStartFiles writes the playground history file with the recorded bytes", () => {
  // Step 1: make an empty temp state folder.
  const stateFolder = mkdtempSync(join(tmpdir(), "start-files-"));
  // Step 2: write the untracked start files.
  writeUntrackedStartFiles(new Path(stateFolder));
  // Step 3: read the file back as bytes.
  const writtenBytes = readFileSync(join(stateFolder, "playground/results/playground-history.json"));
  // Step 4: the file is 137 bytes and equals the constant.
  assert.equal(writtenBytes.length, 137);
  assert.equal(writtenBytes.toString("utf8"), PLAYGROUND_HISTORY_CONTENT);
  // Step 5: the file parses as JSON with one entry.
  const entries = JSON.parse(writtenBytes.toString("utf8"));
  assert.equal(entries.length, 1);
});
