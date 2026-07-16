import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import {
    enableProvenance,
    disableProvenance,
    noteStage,
    drainProvenance,
    clearProvenance,
} from "../src/reconstruction_provenance.ts";

// A throwaway provenance entry for a named stage.
function entryFor(stage: string): Parameters<typeof noteStage>[0] {
    return { stage, target: new Path("/t/x.py"), detail: "did a thing" };
}

test("test_noteStage_records_an_entry_when_provenance_is_enabled", () => {
    // Behavior: with provenance on, a noted stage is captured.
    enableProvenance();
    noteStage(entryFor("seedCopyEvents"));
    assert.equal(drainProvenance().length, 1);
    disableProvenance();
});

test("test_noteStage_records_nothing_when_provenance_is_disabled", () => {
    // Behavior: disabled is the default no-op state — noted stages are dropped.
    disableProvenance();
    clearProvenance();
    noteStage(entryFor("seedCopyEvents"));
    assert.equal(drainProvenance().length, 0);
});

test("test_enableProvenance_clears_any_prior_entries", () => {
    // Behavior: enabling starts a fresh capture (any prior buffer is cleared).
    enableProvenance();
    noteStage(entryFor("completeElidedBeacons"));
    enableProvenance();
    assert.equal(drainProvenance().length, 0);
    disableProvenance();
});

test("test_drainProvenance_returns_entries_then_empties_the_buffer", () => {
    // Behavior: draining returns the captured entries and leaves the buffer empty.
    enableProvenance();
    noteStage(entryFor("seedStaleEditBases"));
    noteStage(entryFor("completeTruncatedBeacon"));
    const drained = drainProvenance();
    assert.equal(drained.length, 2);
    assert.equal(drainProvenance().length, 0);
    disableProvenance();
});

