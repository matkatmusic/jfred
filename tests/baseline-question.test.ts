// Tests for the task-56 pre-baseline question gate: when the active project overrides
// carry a base commit (item 46) and the client has not yet answered, the document build
// must first ask "reconstruct pre-baseline states?" — mirrored on the consent gate.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";
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

// task 152: the re-ask control's two primitives — forget the stored answer, and evict the
// project's cached documents so the next fetch actually reaches the server and re-asks.
test("test_clear_baseline_choice_removes_the_stored_answer", async () => {
    // Step: boot the webapp DOM so sessionStorage exists, then import the fetch module.
    setupWebappDom();
    const { storeBaselineChoice, getBaselineChoice, clearBaselineChoice } = await import("../webapp/app-choices.ts");
    // Step: store an answer, clear it, and observe the not-asked-yet null.
    storeBaselineChoice("proj", "0");
    assert.equal(getBaselineChoice("proj"), "0");
    clearBaselineChoice("proj");
    assert.equal(getBaselineChoice("proj"), null);
});

test("test_drop_project_documents_evicts_only_that_projects_cache_entries", async () => {
    setupWebappDom();
    const { documentCache, dropProjectDocuments } = await import("../webapp/app-fetch.ts");
    // Step: seed cache entries for two projects (the whole-project and one per-jsonl key).
    documentCache.clear();
    documentCache.set("proj|*", {} as never);
    documentCache.set("proj|a.jsonl", {} as never);
    documentCache.set("other|*", {} as never);
    // Step: dropping `proj` leaves only the other project's entry.
    dropProjectDocuments("proj");
    assert.deepEqual([...documentCache.keys()], ["other|*"]);
});
