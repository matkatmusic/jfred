// Tests for the build-stage progress labels and deep engine progress feeding the loading console.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRESS_LABEL_PARSING_RECORDS, type ProgressEvent } from "../src/parse/loadTranscript.ts";
import {
    buildDocumentWithConsent,
    PROGRESS_LABEL_READING_SIDECAR,
    PROGRESS_LABEL_CONSTRUCTING_BRANCHES,
    PROGRESS_LABEL_BUILDING_DOCUMENT,
} from "../src/viewer_api.ts";
import { reportReconstructionProgress } from "../src/reconstruction_progress.ts";
import { Path } from "../src/structures/domain.ts";
import { S19_JSONL } from "./fixtures.ts";
import { copyFixtureIntoTempDir } from "./utilities.ts";

// The uncounted (stageless) labels of a progress stream, in order — drops the per-record events.
function stageLabelsOf(events: ProgressEvent[]): string[] {
    return events.filter((event) => event.current === undefined).map((event) => event.label);
}

// True when `sub` appears as an in-order (not necessarily contiguous) subsequence of `full`.
function isOrderedSubsequence(full: string[], sub: string[]): boolean {
    let cursor = 0;
    for (const label of full) {
        if (cursor < sub.length && label === sub[cursor]) cursor += 1;
    }
    return cursor === sub.length;
}

// -------------------- Step 2: stage labels through the build --------------------

test("test_buildDocumentWithConsent_emits_stage_labels_in_order", () => {
    // Scenario: building announces each engine stage in order and emits no parsing announcement of its own.
    const progressEvents: ProgressEvent[] = [];
    buildDocumentWithConsent([copyFixtureIntoTempDir(S19_JSONL)], undefined, false, (event) => progressEvents.push(event));
    const stageLabels = stageLabelsOf(progressEvents);
    assert.ok(
        isOrderedSubsequence(stageLabels, [
            PROGRESS_LABEL_READING_SIDECAR,
            PROGRESS_LABEL_CONSTRUCTING_BRANCHES,
            PROGRESS_LABEL_BUILDING_DOCUMENT,
        ]),
        `stage labels in order; got ${JSON.stringify(stageLabels)}`,
    );
    // the build emits NO parsing announcement of its own — the walk belongs to the caller's loadProjectRecords call.
    assert.ok(!stageLabels.includes(PROGRESS_LABEL_PARSING_RECORDS));
});

test("test_buildDocumentWithConsent_with_sink_returns_document_identical_to_no_sink_build", () => {
    // Scenario: the sink only observes; the built document is identical with or without it.
    const withoutSink = buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false);
    const withSink = buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false, () => {});
    assert.deepEqual(JSON.parse(JSON.stringify(withSink)), JSON.parse(JSON.stringify(withoutSink)));
});

// -------------------- deep engine progress (module sink) --------------------

test("test_buildDocumentWithConsent_streams_deep_engine_progress_and_clears_the_sink_after", () => {
    // Scenario: the deep pass announces through the build-scoped sink, which is cleared when the build ends.
    const progressEvents: ProgressEvent[] = [];
    buildDocumentWithConsent([copyFixtureIntoTempDir(S19_JSONL)], undefined, false, (event) => progressEvents.push(event));

    const labels = progressEvents.map((event) => event.label);
    assert.ok(
        labels.some((label) => label.startsWith("reconstructing step states")),
        `expected a step-states label; got ${JSON.stringify(labels.filter((l) => l.startsWith("recon")))}`,
    );
    const countedFileEvents = progressEvents.filter(
        (event) => event.current !== undefined && event.label.startsWith("reconstructing /"),
    );
    assert.ok(countedFileEvents.length > 0, "expected counted per-file reconstruction events");

    const collectedBefore = progressEvents.length;
    reportReconstructionProgress("after the build");
    assert.equal(progressEvents.length, collectedBefore);
});
