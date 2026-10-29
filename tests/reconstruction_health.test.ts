import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { FailureScope } from "../src/structures/vocabulary_views.ts";
import {
    reportReconstructionFailure,
    popReconstructionFailures,
    clearReconstructionFailures,
} from "../src/reconstruction_health.ts";

// A throwaway failure entry for a named stage.
function failureFor(stage: string): Parameters<typeof reportReconstructionFailure>[0] {
    return { scope: FailureScope.fileStage, stage, target: new Path("/t/x.py"), reason: "stage threw" };
}

test("test_reportReconstructionFailure_is_returned_by_drain_and_buffer_empties", () => {
    // Behavior: a reported failure comes back once, then the buffer is empty.
    clearReconstructionFailures();
    reportReconstructionFailure(failureFor("fillRedirectContent"));
    const drained = popReconstructionFailures();
    assert.equal(drained.length, 1);
    assert.equal(drained[0]!.stage, "fillRedirectContent");
    assert.equal(drained[0]!.scope, FailureScope.fileStage);
    assert.deepEqual(popReconstructionFailures(), []);
});

test("test_clearReconstructionFailures_discards_pending_entries", () => {
    // Behavior: clearing drops pending entries without returning them.
    reportReconstructionFailure(failureFor("seedBaseCommitBeacon"));
    clearReconstructionFailures();
    assert.deepEqual(popReconstructionFailures(), []);
});
