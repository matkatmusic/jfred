import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildStepStates,
    buildStepChanges,
    buildStepTimeline,
} from "../src/reconstruction_steps.ts";
import {
    getSnapshotFileText,
    trimTrailingNewline,
    isReproducedBySomeStep,
} from "../src/reconstruction_step_snapshot.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { createSidecarReader } from "../src/reconstruction_sidecar_backup_path.ts";
import {
    getDefaultFileHistoryRoot,
    findSessionId,
} from "../src/reconstruction_sidecar_reader.ts";
import { loadRecords } from "./utilities.ts";
import { S19_JSONL } from "./fixtures.ts";

// The bare `add` definition s19 writes first, without a trailing newline.
const ADD_ONLY = "def add(a, b):\n    return a + b";

// The on-disk file-history reader for a transcript's session, built exactly as the CLI builds it.
function realReader(records: ReturnType<typeof loadRecords>): BackupReader | undefined {
    const sessionId = findSessionId(records);
    return sessionId ? createSidecarReader(sessionId, getDefaultFileHistoryRoot()) : undefined;
}

test("test_snapshotFileText_returns_engine_text_for_a_file_present_at_a_step", () => {
    // Behavior: at the first step scenario19.py holds the bare add definition.
    const records = loadRecords(S19_JSONL);
    const steps = buildStepStates(records, realReader(records));
    // Verify: the first step's scenario19.py text is the bare add definition.
    assert.equal(getSnapshotFileText(steps[0]!, "scenario19.py"), ADD_ONLY);
});

test("test_snapshotFileText_returns_undefined_for_a_file_absent_at_a_step", () => {
    // Behavior: the test file is written second, so it does not exist at the first step.
    const records = loadRecords(S19_JSONL);
    const steps = buildStepStates(records, realReader(records));
    // Verify: the test file is absent at the first step.
    assert.equal(getSnapshotFileText(steps[0]!, "tests/test_scenario19.py"), undefined);
});

test("test_someStepReproduces_is_true_when_an_engine_step_matches_ground_truth", () => {
    // Behavior: the first engine step reproduces a ground truth holding the bare add definition.
    const records = loadRecords(S19_JSONL);
    const steps = buildStepStates(records, realReader(records));
    const groundTruth = new Map([["scenario19.py", ADD_ONLY]]);
    // Verify: some engine step reproduces it.
    assert.ok(isReproducedBySomeStep(steps, groundTruth));
});

test("test_someStepReproduces_is_false_when_no_engine_step_matches_ground_truth", () => {
    // Behavior: no engine step reproduces content that the engine never produced.
    const records = loadRecords(S19_JSONL);
    const steps = buildStepStates(records, realReader(records));
    const groundTruth = new Map([["scenario19.py", "def never_written(): pass"]]);
    // Verify: no engine step reproduces it.
    assert.equal(isReproducedBySomeStep(steps, groundTruth), false);
});

test("test_buildStepChanges_has_one_entry_per_buildStepStates_step", () => {
    // Behavior: buildStepChanges matches buildStepStates one to one, in ascending time, with changeIds.
    const records = loadRecords(S19_JSONL);
    const reader = realReader(records);
    const steps = buildStepStates(records, reader);
    const changes = buildStepChanges(records, reader);
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

test("test_buildStepChanges_changeId_resolves_to_a_real_record_uuid_in_s19", () => {
    // Behavior: a step's changeId is the producing record's uuid.
    const records = loadRecords(S19_JSONL);
    const changes = buildStepChanges(records, realReader(records));
    const recordUuids = new Set(
        records.map((record) => record.uuid?.toString()).filter((uuid): uuid is string => uuid !== undefined),
    );
    // Verify: at least one step's changeId resolves to a real record uuid.
    const resolves = changes.some((change) =>
        change.changeIds.some((changeId) => recordUuids.has(changeId.toString())),
    );
    assert.ok(resolves);
});

test("test_buildStepTimeline_returns_histories_and_change_metadata_without_per_step_states", () => {
    // Behavior: buildStepTimeline returns file histories and one change per instant, with no per-step snapshots.
    const records = loadRecords(S19_JSONL);
    const timeline = buildStepTimeline(records, realReader(records));
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

// trimTrailingNewline is exercised indirectly above; assert its contract directly too.
test("test_trimTrailingNewline_drops_exactly_one_trailing_newline", () => {
    // Verify: one trailing newline is removed, the rest of the text is untouched.
    assert.equal(trimTrailingNewline("a\nb\n"), "a\nb");
    assert.equal(trimTrailingNewline("a\nb"), "a\nb");
});

