import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_INSTANT_MIDDLE, TEST_INSTANT_NEWEST, buildInverseCommit } from "./layer1-bars-test-helpers.ts";

test("test_buildInverseCommit_applies_overrides_over_the_defaults", () => {
    // Scenario: buildInverseCommit fills every field with a default and lets the caller replace some.
    // Build a commit with two overrides.
    const commit = buildInverseCommit({ commitHash: "c9", instant: TEST_INSTANT_MIDDLE });
    // The two overridden fields hold the new values.
    assert.equal(commit.commitHash, "c9");
    assert.equal(commit.instant, TEST_INSTANT_MIDDLE);
    // Every other field keeps its default.
    assert.equal(commit.eventType, "GitCommit");
    assert.equal(commit.moment, "at-event");
    assert.equal(commit.confidence, "proven");
    assert.equal(commit.position, 0);
    assert.equal(commit.isFileAbsent, false);
    assert.equal(commit.isRemoved, false);
    assert.equal(commit.movedAwayTo, null);
    // A commit built with no overrides gets the newest instant.
    assert.equal(buildInverseCommit().instant, TEST_INSTANT_NEWEST);
});
