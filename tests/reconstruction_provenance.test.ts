import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import {
    enableProvenance,
    disableProvenance,
    addStageEntry,
    getAndClearProvenance,
    clearProvenance,
} from "../src/reconstruction_provenance.ts";

// A throwaway provenance entry for a named stage.
function entryFor(stage: string): Parameters<typeof addStageEntry>[0] {
    return { stage, target: new Path("/t/x.py"), detail: "did a thing" };
}

test("test_addStageEntry_records_an_entry_when_provenance_is_enabled", () => {
    // Behavior: with provenance on, a noted stage is captured.
    enableProvenance();
    addStageEntry(entryFor("seedCopyEvents"));
    assert.equal(getAndClearProvenance().length, 1);
    disableProvenance();
});

test("test_addStageEntry_records_nothing_when_provenance_is_disabled", () => {
    // Behavior: disabled is the default no-op state — noted stages are dropped.
    disableProvenance();
    clearProvenance();
    addStageEntry(entryFor("seedCopyEvents"));
    assert.equal(getAndClearProvenance().length, 0);
});

test("test_enableProvenance_clears_any_prior_entries", () => {
    // Behavior: enabling starts a fresh capture (any prior buffer is cleared).
    enableProvenance();
    addStageEntry(entryFor("completeElidedBeacons"));
    enableProvenance();
    assert.equal(getAndClearProvenance().length, 0);
    disableProvenance();
});

test("test_getAndClearProvenance_returns_entries_then_empties_the_buffer", () => {
    // Behavior: draining returns the captured entries and leaves the buffer empty.
    enableProvenance();
    addStageEntry(entryFor("seedStaleEditBases"));
    addStageEntry(entryFor("completeTruncatedBeacon"));
    const drained = getAndClearProvenance();
    assert.equal(drained.length, 2);
    assert.equal(getAndClearProvenance().length, 0);
    disableProvenance();
});

