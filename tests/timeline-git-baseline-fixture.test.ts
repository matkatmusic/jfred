// import { test } from "node:test";
// import assert from "node:assert/strict";
// import { gitBaselineDocument } from "./timeline-git-baseline-fixture.ts";

// not behavior: it only checks the shape and counts of a test fixture object, not any product code.
// test("test_git_baseline_document_has_one_turn_pair_and_two_steps", () => {
//     // Scenario: the fixture holds a prompt and a reply, a gitBase step, and an unattributed step.
//     assert.equal(gitBaselineDocument.messages.length, 2);
//     assert.equal(gitBaselineDocument.steps.length, 2);
//     assert.equal(gitBaselineDocument.steps[0]!.changeIds[0], "gitBase:abc1234:orders.py");
//     assert.equal(gitBaselineDocument.steps[1]!.sessionId, undefined);
// });
