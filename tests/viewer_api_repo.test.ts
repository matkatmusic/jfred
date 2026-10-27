// Tests for src/viewer_api_repo.ts: the repo and commit query param checks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { type ServerResponse } from "node:http";
import { sendRepoCommitMatchResponse, sendRepoCommitsResponse } from "../src/viewer_api_repo.ts";

const UNUSED_RESPONSE = {} as ServerResponse;

test("test_sendRepoCommitsResponse_throws_for_a_non_directory", () => {
    // Behavior: a repo param that is not a directory throws before any response is written.  Steps: pass a path that does not exist.
    const query = new URLSearchParams({ repo: "/nonexistent/reveng-repo-dir" });
    assert.throws(() => sendRepoCommitsResponse(UNUSED_RESPONSE, query), /not a directory/);
});

test("test_sendRepoCommitMatchResponse_throws_for_a_non_hex_commit", () => {
    // Behavior: a commit id that is not hex throws before it can reach a shell.  Steps: a real directory plus a commit of "$(x)".
    const query = new URLSearchParams({ repo: ".", commit: "$(x)", project: "p" });
    assert.throws(() => sendRepoCommitMatchResponse(UNUSED_RESPONSE, query), /not a commit hash/);
});
