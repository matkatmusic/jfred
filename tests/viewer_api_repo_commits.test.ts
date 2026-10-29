// Tests for src/viewer_api_repo_commits.ts: the git log parser edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitLogOutput } from "../src/viewer_api_repo_commits.ts";

test("test_parseGitLogOutput_returns_no_rows_for_empty_output", () => {
    // Behavior: empty git log output yields no rows.  Steps: parse "" and a lone newline.
    assert.deepEqual(parseGitLogOutput(""), []);
    assert.deepEqual(parseGitLogOutput("\n"), []);
});
