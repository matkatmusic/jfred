import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { FailureScope } from "../src/structures/vocabulary.ts";
import {
    noteReconstructionFailure,
    drainReconstructionFailures,
    clearReconstructionFailures,
} from "../src/reconstruction_health.ts";

// A throwaway failure entry for a named stage.
function failureFor(stage: string): Parameters<typeof noteReconstructionFailure>[0] {
    return { scope: FailureScope.fileStage, stage, target: new Path("/t/x.py"), reason: "stage threw" };
}

test("test_noteReconstructionFailure_is_returned_by_drain_and_buffer_empties", () => {
    // Behavior: a noted failure comes back from the first drain, and draining empties the buffer — a second drain returns nothing.
    clearReconstructionFailures();
    noteReconstructionFailure(failureFor("fillRedirectContent"));
    const drained = drainReconstructionFailures();
    assert.equal(drained.length, 1);
    assert.equal(drained[0]!.stage, "fillRedirectContent");
    assert.equal(drained[0]!.scope, FailureScope.fileStage);
    assert.deepEqual(drainReconstructionFailures(), []);
});

test("test_clearReconstructionFailures_discards_pending_entries", () => {
    // Behavior: clearing drops pending entries without returning them.
    noteReconstructionFailure(failureFor("seedBaseCommitBeacon"));
    clearReconstructionFailures();
    assert.deepEqual(drainReconstructionFailures(), []);
});
