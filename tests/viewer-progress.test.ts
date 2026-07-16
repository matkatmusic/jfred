// Tests for the live progress stream that feeds the viewer's loading console: loadTranscript's
// per-record announcements (Step 1) and the build's stage labels (Step 2). The server's NDJSON
// wiring (Step 3) is deliberately untested thin glue; the client's line splitter and console
// source tokens (Step 4) are covered in viewer-console-links.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import {
    getRecordSource,
    loadTranscript,
    PROGRESS_LABEL_PARSING_RECORDS,
    type ProgressEvent,
} from "../src/parse/loadTranscript.ts";
import {
    buildDocumentWithConsent,
    PROGRESS_LABEL_READING_SIDECAR,
    PROGRESS_LABEL_CONSTRUCTING_BRANCHES,
    PROGRESS_LABEL_BUILDING_DOCUMENT,
} from "../src/viewer_api.ts";
import {
    loadProjectRecords,
    RECORD_PROGRESS_MAX_LINES,
} from "../src/viewer_api_records.ts";
import { reportReconstructionProgress } from "../src/reconstruction_progress.ts";
import { Path } from "../src/structures/domain.ts";
import { S19_JSONL } from "./fixtures.ts";
import { copyFixtureIntoTempDir } from "./utilities.ts";
import { matchJsonlSourceLink } from "../webapp/app-console.ts";

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

// -------------------- Step 1: loadTranscript emits progress --------------------

test("test_loadTranscript_reports_file_then_parsing_then_per_record_classification", () => {
    // Scenario: loading a transcript announces the file, then that parsing began, then one
    // counted event per non-empty line classifying that record with a running 1..N count.
    // Steps: collect every event while loading the s19 fixture.
    const progressEvents: ProgressEvent[] = [];
    const records = loadTranscript(S19_JSONL, (event) => progressEvents.push(event));

    // event[0] announces the file, with no counts.
    assert.equal(progressEvents[0]!.label, `loading ${basename(S19_JSONL)}`);
    assert.equal(progressEvents[0]!.current, undefined);
    assert.equal(progressEvents[0]!.total, undefined);
    // event[1] announces parsing, with no counts.
    assert.equal(progressEvents[1]!.label, PROGRESS_LABEL_PARSING_RECORDS);
    assert.equal(progressEvents[1]!.current, undefined);
    assert.equal(progressEvents[1]!.total, undefined);
    // exactly one counted event per record: current runs 1..N, total = N, label = the record's
    // type plus its clickable "[<jsonl>:<line>]" source token (the console link provider's food).
    const countedEvents = progressEvents.filter((event) => event.current !== undefined);
    assert.equal(countedEvents.length, records.length);
    for (const [index, event] of countedEvents.entries()) {
        assert.equal(event.current, index + 1);
        assert.equal(event.total, records.length);
        const source = getRecordSource(records[index]!);
        assert.equal(event.label, `${records[index]!.type} [${basename(S19_JSONL)}:${source!.lineNumber}]`);
    }
});

test("test_document_request_sequence_walks_records_once_when_cold", () => {
    // Scenario: one /api/document request = one per-record console walk. The route loads
    // records with its sink (the walk), then builds with the same sink — the build must not
    // walk them again.
    // Steps:
    // run the route's sequence cold (fresh temp copy) with one collecting sink.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).length;
    const requestEvents: ProgressEvent[] = [];
    const sink = (event: ProgressEvent) => requestEvents.push(event);
    loadProjectRecords([jsonlPath], sink);
    buildDocumentWithConsent([jsonlPath], undefined, false, sink);
    // per-record events (counted with total === recordCount) appear exactly once per record.
    const perRecordCount = requestEvents.filter((event) => event.total === recordCount).length;
    assert.equal(perRecordCount, recordCount);
});

test("test_document_request_sequence_walks_records_once_when_cached", () => {
    // Scenario: a warm request (records + artifact caches hit) still shows the walk exactly
    // once — loadProjectRecords' replay — not a second replay from the cached build.
    // Steps:
    // prime both caches, then re-run the route's sequence with a collecting sink.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).length;
    loadProjectRecords([jsonlPath]);
    buildDocumentWithConsent([jsonlPath], undefined, false);
    const requestEvents: ProgressEvent[] = [];
    const sink = (event: ProgressEvent) => requestEvents.push(event);
    loadProjectRecords([jsonlPath], sink);
    buildDocumentWithConsent([jsonlPath], undefined, false, sink);
    // Throttled cache-hit replay (item 82): bounded and strictly monotonic, reaching 100% once. A
    // second replay from the cached build would reset `current` and break the monotonic check.
    const perRecordEvents = requestEvents.filter((event) => event.total === recordCount);
    assert.ok(perRecordEvents.length >= 1 && perRecordEvents.length <= RECORD_PROGRESS_MAX_LINES);
    for (let i = 1; i < perRecordEvents.length; i++) {
        assert.ok(perRecordEvents[i]!.current! > perRecordEvents[i - 1]!.current!, "walked once → strictly increasing");
    }
    assert.equal(perRecordEvents.at(-1)!.current, recordCount);
});

test("test_per_record_progress_labels_carry_source_tokens_cold_and_cached", () => {
    // Scenario: every per-record console line — cold parse AND cache replay — carries the
    // "[<jsonl>:<line>]" token matchJsonlSourceLink turns into a jump to that raw line.
    // Steps:
    // load twice (cold parse, then cached replay); assert every counted label in both streams
    // carries the token.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).length;
    const coldEvents: ProgressEvent[] = [];
    loadProjectRecords([jsonlPath], (event) => coldEvents.push(event));
    const warmEvents: ProgressEvent[] = [];
    loadProjectRecords([jsonlPath], (event) => warmEvents.push(event));
    for (const events of [coldEvents, warmEvents]) {
        const perRecordEvents = events.filter((event) => event.total === recordCount);
        assert.ok(perRecordEvents.length > 0);
        for (const event of perRecordEvents) {
            const link = matchJsonlSourceLink(event.label);
            assert.ok(link !== undefined, `no source token in "${event.label}"`);
            assert.equal(link!.jsonlFileName, "session.jsonl");
        }
    }
});

test("test_loadTranscript_stamps_each_record_with_its_source_file_and_line", () => {
    // Scenario: every parsed record can be traced back to the transcript file and 1-based line
    // it came from (console labels append this so a broken line is findable in an editor), and
    // the stamp rides beside the record — its own top-level shape is untouched.
    // Steps: load the s19 fixture, check the first record's source, and that line numbers
    // strictly increase in file order.
    const records = loadTranscript(S19_JSONL);
    const firstSource = getRecordSource(records[0]!);
    assert.equal(firstSource?.filePath, S19_JSONL);
    assert.equal(firstSource?.lineNumber, 1);
    const lineNumbers = records.map((record) => getRecordSource(record)?.lineNumber ?? 0);
    for (let i = 1; i < lineNumbers.length; i += 1) {
        assert.ok(lineNumbers[i]! > lineNumbers[i - 1]!, `line numbers must increase (index ${i})`);
    }
});

test("test_loadTranscript_without_sink_returns_identical_records", () => {
    // Scenario: the sink is observation-only — the records returned are identical with or
    // without it, so no caller behaviour changes when it starts passing a sink.
    // Steps: load the fixture both ways and deep-equal the two arrays.
    const withoutSink = loadTranscript(S19_JSONL);
    const withSink = loadTranscript(S19_JSONL, () => {});
    assert.deepEqual(withSink, withoutSink);
});

// -------------------- Step 2: stage labels through the build --------------------

test("test_buildDocumentWithConsent_emits_stage_labels_in_order", () => {
    // Scenario: building a document announces each engine stage in order; the build assumes its
    // caller already walked records, so it emits no parsing announcement of its own.
    // Steps: build the s19 document with a collecting sink; assert the three stage labels appear
    // as an in-order subsequence of the uncounted labels.
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
    // the build emits NO parsing announcement of its own — the walk belongs to the caller's
    // loadProjectRecords call.
    assert.ok(!stageLabels.includes(PROGRESS_LABEL_PARSING_RECORDS));
});

test("test_buildDocumentWithConsent_with_sink_returns_document_identical_to_no_sink_build", () => {
    // Scenario: the sink observes only — the built document is identical with or without it.
    // Steps: build twice, with and without a sink, and deep-equal the two documents.
    const withoutSink = buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false);
    const withSink = buildDocumentWithConsent([new Path(S19_JSONL)], undefined, false, () => {});
    assert.deepEqual(JSON.parse(JSON.stringify(withSink)), JSON.parse(JSON.stringify(withoutSink)));
});

// -------------------- deep engine progress (module sink) --------------------

test("test_buildDocumentWithConsent_streams_deep_engine_progress_and_clears_the_sink_after", () => {
    // Scenario: the deep reconstruction pass announces through the build-scoped module sink —
    // the unified step-timeline reconstruction (states + changes in one pass) and counted
    // per-file events — and the sink is cleared when the build ends, so reporting afterwards
    // reaches nothing.
    // Steps: build s19 with a collecting sink, assert the deep labels arrived, then report after
    // the build and assert nothing more was collected.
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

