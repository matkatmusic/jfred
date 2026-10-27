// Tests for the progress stream feeding the loading console: per-record announcements (build labels: viewer-progress-build.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import {
    getRecordSource,
    loadTranscript,
    PROGRESS_LABEL_PARSING_RECORDS,
    type ProgressEvent,
} from "../src/parse/loadTranscript.ts";
import { buildDocumentWithConsent } from "../src/viewer_api.ts";
import {
    loadProjectRecords,
    RECORD_PROGRESS_MAX_LINES,
} from "../src/viewer_api_records.ts";
import { S19_JSONL } from "./fixtures.ts";
import { copyFixtureIntoTempDir } from "./utilities.ts";
import { matchJsonlSourceLink } from "../webapp/app-console-text.ts";

// -------------------- Step 1: loadTranscript emits progress --------------------

test("test_loadTranscript_reports_file_then_parsing_then_per_record_classification", () => {
    // Scenario: loading announces the file, then parsing, then one counted event per non-empty line.
    const progressEvents: ProgressEvent[] = [];
    const { records } = loadTranscript(S19_JSONL, (event) => progressEvents.push(event));

    // event[0] announces the file, with no counts.
    assert.equal(progressEvents[0]!.label, `loading ${basename(S19_JSONL)}`);
    assert.equal(progressEvents[0]!.current, undefined);
    assert.equal(progressEvents[0]!.total, undefined);
    // event[1] announces parsing, with no counts.
    assert.equal(progressEvents[1]!.label, PROGRESS_LABEL_PARSING_RECORDS);
    assert.equal(progressEvents[1]!.current, undefined);
    assert.equal(progressEvents[1]!.total, undefined);
    // One counted event per record: current runs 1..N, total = N, label = type plus source token.
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
    // Scenario: one /api/document request makes one per-record console walk; the build must not repeat it.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).records.length;
    const requestEvents: ProgressEvent[] = [];
    const sink = (event: ProgressEvent) => requestEvents.push(event);
    loadProjectRecords([jsonlPath], sink);
    buildDocumentWithConsent([jsonlPath], undefined, false, sink);
    // per-record events (counted with total === recordCount) appear exactly once per record.
    const perRecordCount = requestEvents.filter((event) => event.total === recordCount).length;
    assert.equal(perRecordCount, recordCount);
});

test("test_document_request_sequence_walks_records_once_when_cached", () => {
    // Scenario: a warm request still shows the walk exactly once, not a second replay from the cached build.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).records.length;
    loadProjectRecords([jsonlPath]);
    buildDocumentWithConsent([jsonlPath], undefined, false);
    const requestEvents: ProgressEvent[] = [];
    const sink = (event: ProgressEvent) => requestEvents.push(event);
    loadProjectRecords([jsonlPath], sink);
    buildDocumentWithConsent([jsonlPath], undefined, false, sink);
    // Throttled cache-hit replay (item 82): bounded, strictly monotonic, reaching 100% once.
    const perRecordEvents = requestEvents.filter((event) => event.total === recordCount);
    assert.ok(perRecordEvents.length >= 1 && perRecordEvents.length <= RECORD_PROGRESS_MAX_LINES);
    for (let i = 1; i < perRecordEvents.length; i++) {
        assert.ok(perRecordEvents[i]!.current! > perRecordEvents[i - 1]!.current!, "walked once → strictly increasing");
    }
    assert.equal(perRecordEvents.at(-1)!.current, recordCount);
});

test("test_per_record_progress_labels_carry_source_tokens_cold_and_cached", () => {
    // Scenario: every per-record line, cold parse and cache replay, carries the source token for a jump.
    const jsonlPath = copyFixtureIntoTempDir(S19_JSONL);
    const recordCount = loadTranscript(jsonlPath.toString()).records.length;
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
    // Scenario: every parsed record traces back to its file and 1-based line; line numbers strictly increase.
    const { records } = loadTranscript(S19_JSONL);
    const firstSource = getRecordSource(records[0]!);
    assert.equal(firstSource?.filePath, S19_JSONL);
    assert.equal(firstSource?.lineNumber, 1);
    const lineNumbers = records.map((record) => getRecordSource(record)?.lineNumber ?? 0);
    for (let i = 1; i < lineNumbers.length; i += 1) {
        assert.ok(lineNumbers[i]! > lineNumbers[i - 1]!, `line numbers must increase (index ${i})`);
    }
});

test("test_loadTranscript_without_sink_returns_identical_records", () => {
    // Scenario: the sink only observes; records are identical with or without it.
    const withoutSink = loadTranscript(S19_JSONL);
    const withSink = loadTranscript(S19_JSONL, () => {});
    assert.deepEqual(withSink, withoutSink);
});


