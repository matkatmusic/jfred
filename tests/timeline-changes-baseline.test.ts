// Git-baseline changeId helpers that the details pane keys on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isChangeIdGitBaseline } from "../webapp/views/details-model.ts";
import { extractGitBaseCommitHash } from "../webapp/views/timeline-changes.ts";

test("test_isChangeIdGitBaseline_detects_beacon_changeIds", () => {
    // A gitBase-prefixed changeId is a baseline beacon.
    assert.equal(isChangeIdGitBaseline("gitBase:abc1234:orders.py"), true);
    // an ordinary tool_use changeId is not.
    assert.equal(isChangeIdGitBaseline("toolu_w1"), false);
    // an absent changeId is not.
    assert.equal(isChangeIdGitBaseline(undefined), false);
});

test("test_extractGitBaseCommitHash_reads_the_hash_field", () => {
    // The hash is the second colon-separated field of a beacon changeId.
    assert.equal(extractGitBaseCommitHash("gitBase:abc1234:orders.py"), "abc1234");
    // a malformed id degrades to an empty string, never a throw.
    assert.equal(extractGitBaseCommitHash("gitBase:"), "");
});
