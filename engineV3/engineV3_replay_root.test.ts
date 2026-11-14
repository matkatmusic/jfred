import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import { findReplayRoot } from "./engineV3_replay_root.ts";

const STATE = new Path("/Users/matkatmusicllc/Programming/typesafe-playground");
const MEMORY_FOLDER = "/Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground/memory";

test("test_findReplayRoot_picks_the_claude_memory_folder_for_a_memory_file", () => {
  // Scenario: a recorded Write of a memory file replays into the memory folder, so a later recorded cat of it finds it.
  // a memory file path outside the state folder
  const memoryFile = new Path(`${MEMORY_FOLDER}/MEMORY.md`);
  // the root is the memory folder
  assert.equal(findReplayRoot(STATE, memoryFile)?.toString(), MEMORY_FOLDER);
});

test("test_findReplayRoot_has_no_root_for_other_claude_project_files", () => {
  // Scenario: only memory files get a root; a session JSONL in the same project folder stays outside.
  // a path in the project folder, outside the memory folder
  const sessionFile = new Path("/Users/matkatmusicllc/.claude/projects/-Users-matkatmusicllc-Programming-typesafe-playground/abc.jsonl");
  // there is no root
  assert.equal(findReplayRoot(STATE, sessionFile), undefined);
});
