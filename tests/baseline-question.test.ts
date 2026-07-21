// Tests for the task-56 pre-baseline question gate: when the active project overrides
// carry a base commit (item 46) and the client has not yet answered, the document build
// must first ask "reconstruct pre-baseline states?" — mirrored on the consent gate.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { decideBaselineQuestion } from "../src/viewer_api.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

test("test_baseline_question_required_when_base_commit_configured_and_no_choice_made", () => {
    // Scenario: repoDir+baseCommit overrides are active and no preBaseline choice arrived —
    // the question payload rides the wire with the discriminant plus repo + commit strings.
    setPathOverrides({ repoDir: new Path("/tmp/some-repo"), baseCommit: new Uuid("abc123") });
    // Step: no choice made yet -> the question is required.
    const question = decideBaselineQuestion(false);
    assert.ok(question !== undefined);
    // Step: the payload carries the enum discriminant and both display fields.
    assert.ok(question.kind === DocumentResponseKind.baselineQuestionRequired);
    assert.equal(question.baseCommit, "abc123");
    assert.equal(question.repo, "/tmp/some-repo");
});

test("test_no_baseline_question_without_base_commit_override", () => {
    // Scenario: an ordinary project (no baseline configured) must never see the question,
    // whether or not a choice param arrived.
    setPathOverrides({});
    // Step: empty overrides -> undefined either way.
    assert.equal(decideBaselineQuestion(false), undefined);
    assert.equal(decideBaselineQuestion(true), undefined);
});

test("test_no_baseline_question_when_choice_already_made", () => {
    // Scenario: the client already answered (preBaseline param present) — the gate stands
    // aside and the build proceeds under that answer.
    setPathOverrides({ repoDir: new Path("/tmp/some-repo"), baseCommit: new Uuid("abc123") });
    // Step: choiceMade true -> undefined even with a configured baseline.
    assert.equal(decideBaselineQuestion(true), undefined);
});
