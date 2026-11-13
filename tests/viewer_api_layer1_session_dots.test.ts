// GET /api/layer1-session-dots: the dots in [from, to] plus every kept session's span (task 888 step 18).

import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { dirname } from "node:path";
import { test } from "node:test";
import { encodeProjectFolderName } from "../src/reconstruction_repo_discovery.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { sendLayer1SessionDotsResponse } from "../src/viewer_api_layer1_session_dots.ts";
import type { WireSessionDots } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import { writeSessionTranscript, SESSION_ONE } from "./layer1-snapshot-wire-test-helpers.ts";
import { createFixtureDiskFolder } from "./layer1-view-test-helpers.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const TEN_O_CLOCK = "2026-07-01T10:00:00.000Z";
const ELEVEN_O_CLOCK = "2026-07-01T11:00:00.000Z";
const TWELVE_O_CLOCK = "2026-07-01T12:00:00.000Z";
const ELEVEN_DOT_UUID = "11111111-0000-0000-0000-000000000002";

function buildUserRecord(uuid: string, instant: string): object {
    return { type: RecordType.user, uuid, sessionId: SESSION_ONE, timestamp: instant, message: { role: "user", content: `at ${instant}` } };
}

function writeThreeDotLog(diskDir: string): string {
    const records = [
        buildUserRecord("11111111-0000-0000-0000-000000000001", TEN_O_CLOCK),
        buildUserRecord(ELEVEN_DOT_UUID, ELEVEN_O_CLOCK),
        buildUserRecord("11111111-0000-0000-0000-000000000003", TWELVE_O_CLOCK),
    ];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records, encodeProjectFolderName(diskDir));
    return dirname(logFile.toString());
}

function askDots(query: URLSearchParams): WireSessionDots {
    let body = "";
    const response = { writeHead: () => response, end: (chunk: string) => { body = chunk; } } as unknown as ServerResponse;
    sendLayer1SessionDotsResponse(response, query);
    return JSON.parse(body) as WireSessionDots;
}

function buildQuery(diskDir: string, logFolder: string, from: string, to: string): URLSearchParams {
    return new URLSearchParams({ dir: diskDir, jsonl: logFolder, from, to });
}

test("test_the_answer_holds_the_dots_inside_the_range_and_every_session_span", () => {
    // Scenario: the range cuts the log to one dot, but the span list still covers the whole session.
    // a project log holds three dots at 10:00, 11:00 and 12:00
    const diskDir = createFixtureDiskFolder();
    const logFolder = writeThreeDotLog(diskDir);
    // ask for 10:30 to 11:30
    const answer = askDots(buildQuery(diskDir, logFolder, "2026-07-01T10:30:00.000Z", "2026-07-01T11:30:00.000Z"));
    // only the 11:00 dot is in the answer
    assert.equal(answer.annotations.length, 1);
    assert.equal(answer.annotations[0]!.instant, ELEVEN_O_CLOCK);
    // the one span runs from 10:00 to 12:00
    assert.deepEqual(answer.sessionSpans, [{ sessionId: SESSION_ONE, first: TEN_O_CLOCK, last: TWELVE_O_CLOCK }]);
});

test("test_the_answer_serializes_instants_as_iso_text_and_ids_as_strings", () => {
    // Scenario: the wire carries plain text for every Date and Uuid.
    // a project log holds three dots
    const diskDir = createFixtureDiskFolder();
    const logFolder = writeThreeDotLog(diskDir);
    // ask for a range around the 11:00 dot
    const answer = askDots(buildQuery(diskDir, logFolder, "2026-07-01T10:30:00.000Z", "2026-07-01T11:30:00.000Z"));
    // the dot's instant is ISO text
    assert.equal(typeof answer.annotations[0]!.instant, "string");
    assert.equal(answer.annotations[0]!.instant, ELEVEN_O_CLOCK);
    // the dot's id and session id are plain strings
    assert.equal(answer.annotations[0]!.id, ELEVEN_DOT_UUID);
    assert.equal(answer.annotations[0]!.sessionId, SESSION_ONE);
    // the span's first and last are ISO text
    assert.equal(answer.sessionSpans[0]!.first, TEN_O_CLOCK);
    assert.equal(answer.sessionSpans[0]!.last, TWELVE_O_CLOCK);
});

test("test_a_missing_jsonl_param_throws_missing_query_param", () => {
    // Scenario: a request without any jsonl folder is refused by name.
    // ask with dir, from and to but no jsonl
    const diskDir = createFixtureDiskFolder();
    const query = new URLSearchParams({ dir: diskDir, from: TEN_O_CLOCK, to: TWELVE_O_CLOCK });
    // the route throws and names the missing param
    assert.throws(() => askDots(query), /missing query param: jsonl/);
});

test("test_a_bad_from_throws", () => {
    // Scenario: a from that is not an instant is refused by name.
    // ask with from set to text that is not a date
    const diskDir = createFixtureDiskFolder();
    const logFolder = writeThreeDotLog(diskDir);
    const query = buildQuery(diskDir, logFolder, "not-a-date", TWELVE_O_CLOCK);
    // the route throws and names the bad param
    assert.throws(() => askDots(query), /not an instant: from/);
});

test("test_a_missing_dir_folder_throws", () => {
    // Scenario: a dir that is not on disk is refused by name.
    // ask with a dir that does not exist
    const diskDir = createFixtureDiskFolder();
    const logFolder = writeThreeDotLog(diskDir);
    const query = buildQuery(`${diskDir}-missing`, logFolder, TEN_O_CLOCK, TWELVE_O_CLOCK);
    // the route throws and says the folder does not exist
    assert.throws(() => askDots(query), /dir folder does not exist/);
});
