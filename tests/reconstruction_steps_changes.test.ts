import { test } from "node:test";
import assert from "node:assert/strict";
import {
    reconstructStepStates,
    reconstructStepChanges,
    reconstructStepTimeline,
    snapshotFileText,
    stripTrailingNewline,
    someStepReproduces,
} from "../src/reconstruction_steps.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import {
    createSidecarReader,
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

// The bare `add` definition s19 writes first (no trailing newline — the engine drops it at replay).
const ADD_ONLY = "def add(a, b):\n    return a + b";

// The on-disk file-history reader for a transcript's session, built exactly as the CLI builds it.
function realReader(records: ReturnType<typeof loadRecords>): BackupReader | undefined {
    const sessionId = findSessionId(records);
    return sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
}

test("test_snapshotFileText_returns_engine_text_for_a_file_present_at_a_step", () => {
    // Behavior: at the first step scenario19.py exists with the bare add definition, so snapshotFileText
    // finds it by its repo-relative path.
    const records = loadRecords(S19_JSONL);
    const steps = reconstructStepStates(records, realReader(records));
    // Verify: the first step's scenario19.py text is the bare add definition.
    assert.equal(snapshotFileText(steps[0]!, "scenario19.py"), ADD_ONLY);
});

test("test_snapshotFileText_returns_undefined_for_a_file_absent_at_a_step", () => {
    // Behavior: the test file is written second, so it does not exist at the first step.
    const records = loadRecords(S19_JSONL);
    const steps = reconstructStepStates(records, realReader(records));
    // Verify: the test file is absent at the first step.
    assert.equal(snapshotFileText(steps[0]!, "tests/test_scenario19.py"), undefined);
});

test("test_someStepReproduces_is_true_when_an_engine_step_matches_ground_truth", () => {
    // Behavior: a ground-truth folder holding scenario19.py == the bare add definition is reproduced by the
    // first engine step.
    const records = loadRecords(S19_JSONL);
    const steps = reconstructStepStates(records, realReader(records));
    const groundTruth = new Map([["scenario19.py", ADD_ONLY]]);
    // Verify: some engine step reproduces it.
    assert.ok(someStepReproduces(steps, groundTruth));
});

test("test_someStepReproduces_is_false_when_no_engine_step_matches_ground_truth", () => {
    // Behavior: a ground-truth folder whose content no engine step ever produced is not reproduced.
    const records = loadRecords(S19_JSONL);
    const steps = reconstructStepStates(records, realReader(records));
    const groundTruth = new Map([["scenario19.py", "def never_written(): pass"]]);
    // Verify: no engine step reproduces it.
    assert.equal(someStepReproduces(steps, groundTruth), false);
});

test("test_reconstructStepChanges_has_one_entry_per_reconstructStepStates_step", () => {
    // Behavior: reconstructStepChanges is aligned 1:1 with reconstructStepStates — same count, ascending
    // change-times, each step triggered by at least one changeId.
    const records = loadRecords(S19_JSONL);
    const reader = realReader(records);
    const steps = reconstructStepStates(records, reader);
    const changes = reconstructStepChanges(records, reader);
    // Verify: equal length...
    assert.equal(changes.length, steps.length);
    // ...ascending change-times, each with at least one triggering changeId.
    for (let index = 1; index < changes.length; index += 1) {
        assert.ok(changes[index]!.when.getTime() >= changes[index - 1]!.when.getTime());
    }
    for (const change of changes) {
        assert.ok(change.changeIds.length >= 1);
    }
});

test("test_reconstructStepChanges_changeId_resolves_to_a_real_record_uuid_in_s19", () => {
    // Behavior: a step's triggering changeId is the producing record's uuid, so it resolves against the
    // transcript's record uuids.
    const records = loadRecords(S19_JSONL);
    const changes = reconstructStepChanges(records, realReader(records));
    const recordUuids = new Set(
        records.map((record) => record.uuid?.toString()).filter((uuid): uuid is string => uuid !== undefined),
    );
    // Verify: at least one step's changeId resolves to a real record uuid.
    const resolves = changes.some((change) =>
        change.changeIds.some((changeId) => recordUuids.has(changeId.toString())),
    );
    assert.ok(resolves);
});

test("test_reconstructStepTimeline_returns_histories_and_change_metadata_without_per_step_states", () => {
    // Behavior: reconstructStepTimeline exposes the compact per-file histories the steps derive from and
    // one change entry per distinct change instant, WITHOUT materializing a repo snapshot for every step
    // (the O(steps × live-bytes) blow-up the wire-size fix removes). S19 touches two files, one revised
    // more than once, so histories has ≥2 entries and changes has ≥3 instants.
    const records = loadRecords(S19_JSONL);
    const timeline = reconstructStepTimeline(records, realReader(records));
    // Verify: histories are the compact FileHistory form...
    assert.ok(timeline.histories.length >= 2);
    assert.ok(timeline.histories.every((history) => Array.isArray(history.revisions)));
    // ...one change entry per instant, each triggered by ≥1 changeId...
    assert.ok(timeline.changes.length >= 3);
    for (const change of timeline.changes) {
        assert.ok(change.changeIds.length >= 1);
    }
    // ...and no expanded per-step file-snapshot array rides along (compile-time: the type has no `states`).
    assert.equal((timeline as Record<string, unknown>)["states"], undefined);
});

// stripTrailingNewline is exercised indirectly above; assert its contract directly too.
test("test_stripTrailingNewline_drops_exactly_one_trailing_newline", () => {
    // Verify: one trailing newline is removed, the rest of the text is untouched.
    assert.equal(stripTrailingNewline("a\nb\n"), "a\nb");
    assert.equal(stripTrailingNewline("a\nb"), "a\nb");
});

