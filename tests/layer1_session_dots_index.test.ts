// The in-memory session dot index: project-log and mention rules, per-file freshness, progress events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { utimesSync } from "node:fs"; // was: import { statSync, utimesSync } from "node:fs";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import type { Layer1WireAnnotation } from "../src/layer1_session_dots_types.ts";
import { LAYER1_PROGRESS_LABEL_INDEXING_SESSION_DOTS, getSessionDotIndex } from "../src/layer1_session_dots_index.ts";
import { SESSION_ONE, SESSION_TWO, writeSessionTranscript } from "./layer1-snapshot-wire-test-helpers.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const PROJECT_DIR = new Path("/Users/x/Programming/jot");
const PROJECT_FOLDER_NAME = "-Users-x-Programming-jot";
const MENTION = "/Users/x/Programming/jot/src/a.ts";
const SIBLING_MENTION = "/Users/x/Programming/jot-recovery/b";
const FIXED_MTIME = new Date("2026-01-01T00:00:00.000Z");

function buildUserRecord(sessionId: string, timestamp: string | undefined, content: string): object {
    return { type: RecordType.user, sessionId, timestamp, message: { role: "user", content } };
}

function buildTitleRecord(sessionId: string, title: string): object { return { type: RecordType.customTitle, sessionId, customTitle: title }; }

function listTitles(dots: Layer1WireAnnotation[]): string[] { return dots.map((dot) => dot.sessionTitle); }

test("test_a_project_log_keeps_every_line", () => {
    // a log under the project's folder name holds two lines that never mention the dir.
    const records = [buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", "one"), buildUserRecord(SESSION_ONE, "2026-07-01T11:00:00.000Z", "two")];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records, PROJECT_FOLDER_NAME);
    assert.equal(getSessionDotIndex(PROJECT_DIR, [logFile]).dots.length, 2);
});

test("test_another_log_keeps_only_the_lines_that_mention_the_dir", () => {
    // three lines: a mention of the dir, a mention of a sibling dir, and no mention.
    const records = [
        buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", `edit ${MENTION}`),
        buildUserRecord(SESSION_ONE, "2026-07-01T11:00:00.000Z", `edit ${SIBLING_MENTION}`),
        buildUserRecord(SESSION_ONE, "2026-07-01T12:00:00.000Z", "nothing"),
    ];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records);
    const dots = getSessionDotIndex(PROJECT_DIR, [logFile]).dots;
    assert.deepEqual(dots.map((dot) => dot.line), [1]);
});

test("test_another_log_that_never_mentions_the_dir_makes_no_dots", () => {
    const records = [buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", `edit ${SIBLING_MENTION}`)];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records);
    assert.equal(getSessionDotIndex(PROJECT_DIR, [logFile]).dots.length, 0);
});

test("test_a_log_in_a_sibling_project_folder_is_treated_as_another_log", () => {
    // the sibling folder name starts with the project's folder name, and its lines do not mention the dir.
    const records = [buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", `edit ${MENTION}`), buildUserRecord(SESSION_ONE, "2026-07-01T11:00:00.000Z", "nothing")];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records, `${PROJECT_FOLDER_NAME}-recovery`);
    // only the mentioning line is kept, so the folder was not taken as the project's.
    assert.deepEqual(getSessionDotIndex(PROJECT_DIR, [logFile]).dots.map((dot) => dot.line), [1]);
});

test("test_a_kept_line_borrows_the_instant_of_a_line_the_filter_dropped", () => {
    // in another log, line 1 has an instant and no mention; line 2 has no instant and a mention.
    const records = [buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", "nothing"), buildUserRecord(SESSION_ONE, undefined, `edit ${MENTION}`)];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records);
    const dots = getSessionDotIndex(PROJECT_DIR, [logFile]).dots;
    // the kept dot is line 2, flagged stampless, with the instant of line 1.
    assert.equal(dots.length, 1);
    assert.equal(dots[0]!.isStampless, true);
    assert.equal(dots[0]!.instant.toISOString(), "2026-07-01T10:00:00.000Z");
});

test("test_dots_from_two_logs_are_sorted_ascending_by_instant", () => {
    // log one holds 12:00 then 10:00; log two holds 11:00.
    const treeRoot = createTempDir();
    const logOne = writeSessionTranscript(treeRoot, SESSION_ONE, [buildUserRecord(SESSION_ONE, "2026-07-01T12:00:00.000Z", "a"), buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", "b")], PROJECT_FOLDER_NAME);
    const logTwo = writeSessionTranscript(treeRoot, SESSION_TWO, [buildUserRecord(SESSION_TWO, "2026-07-01T11:00:00.000Z", "c")], PROJECT_FOLDER_NAME);
    const dots = getSessionDotIndex(PROJECT_DIR, [logOne, logTwo]).dots;
    assert.deepEqual(dots.map((dot) => dot.instant.toISOString()), ["2026-07-01T10:00:00.000Z", "2026-07-01T11:00:00.000Z", "2026-07-01T12:00:00.000Z"]);
});

test("test_session_spans_cover_only_the_kept_lines", () => {
    // another log: the kept line is at 11:00; the lines at 10:00 and 12:00 are dropped.
    const records = [
        buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", "nothing"),
        buildUserRecord(SESSION_ONE, "2026-07-01T11:00:00.000Z", `edit ${MENTION}`),
        buildUserRecord(SESSION_ONE, "2026-07-01T12:00:00.000Z", "nothing"),
    ];
    const logFile = writeSessionTranscript(createTempDir(), SESSION_ONE, records);
    const spans = getSessionDotIndex(PROJECT_DIR, [logFile]).sessionSpans;
    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.first.toISOString(), "2026-07-01T11:00:00.000Z");
    assert.equal(spans[0]!.last.toISOString(), "2026-07-01T11:00:00.000Z");
});

// A project log with one title; the dot after the title carries it.
function writeLogWithTitle(treeRoot: string, title: string): Path {
    return writeSessionTranscript(treeRoot, SESSION_ONE, [buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", "x"), buildTitleRecord(SESSION_ONE, title), buildUserRecord(SESSION_ONE, "2026-07-01T11:00:00.000Z", "y")], PROJECT_FOLDER_NAME);
}

test("test_an_unchanged_file_is_not_read_again", () => {
    // build once with title "alpha".
    const treeRoot = createTempDir();
    const logFile = writeLogWithTitle(treeRoot, "alpha");
    utimesSync(logFile.toString(), FIXED_MTIME, FIXED_MTIME); // was: const oldStats = statSync(logFile.toString());
    getSessionDotIndex(PROJECT_DIR, [logFile]);
    // rewrite with same-length text, then set the same whole-second mtime so the stamp is unchanged.
    writeLogWithTitle(treeRoot, "bravo");
    utimesSync(logFile.toString(), FIXED_MTIME, FIXED_MTIME); // was: utimesSync(logFile.toString(), oldStats.atime, oldStats.mtime);
    // the old title is still returned.
    assert.ok(listTitles(getSessionDotIndex(PROJECT_DIR, [logFile]).dots).includes("alpha"));
});

test("test_a_changed_file_is_rebuilt", () => {
    // build once with title "alpha".
    const treeRoot = createTempDir();
    const logFile = writeLogWithTitle(treeRoot, "alpha");
    utimesSync(logFile.toString(), FIXED_MTIME, FIXED_MTIME); // was: const oldStats = statSync(logFile.toString());
    getSessionDotIndex(PROJECT_DIR, [logFile]);
    // rewrite with same-length text and a later whole-second mtime.
    writeLogWithTitle(treeRoot, "bravo");
    const laterMtime = new Date(FIXED_MTIME.getTime() + 10_000); // was: utimesSync(..., oldStats.atime, new Date(oldStats.mtimeMs + 10_000));
    utimesSync(logFile.toString(), laterMtime, laterMtime);
    assert.ok(listTitles(getSessionDotIndex(PROJECT_DIR, [logFile]).dots).includes("bravo"));
});

test("test_a_file_that_leaves_the_file_list_leaves_the_index", () => {
    // build with two files, then with one.
    const treeRoot = createTempDir();
    const logOne = writeSessionTranscript(treeRoot, SESSION_ONE, [buildUserRecord(SESSION_ONE, "2026-07-01T10:00:00.000Z", "a")], PROJECT_FOLDER_NAME);
    const logTwo = writeSessionTranscript(treeRoot, SESSION_TWO, [buildUserRecord(SESSION_TWO, "2026-07-01T11:00:00.000Z", "b")], PROJECT_FOLDER_NAME);
    assert.equal(getSessionDotIndex(PROJECT_DIR, [logOne, logTwo]).dots.length, 2);
    const dots = getSessionDotIndex(PROJECT_DIR, [logOne]).dots;
    assert.deepEqual(dots.map((dot) => dot.sessionFile), [logOne.toString()]);
});

test("test_one_counted_progress_event_per_file_and_none_without_files", () => {
    // three fresh files, a sink that keeps the indexing events.
    const treeRoot = createTempDir();
    const files = [SESSION_ONE, SESSION_TWO, "c3d4e5f6-0000-0000-0000-000000000003"].map((id) => writeSessionTranscript(treeRoot, id, [buildUserRecord(id, "2026-07-01T10:00:00.000Z", "a")], PROJECT_FOLDER_NAME));
    const events: ProgressEvent[] = [];
    const recordEvent = (event: ProgressEvent): void => { if (event.label === LAYER1_PROGRESS_LABEL_INDEXING_SESSION_DOTS) events.push(event); };
    getSessionDotIndex(PROJECT_DIR, files, recordEvent);
    // events count 1 to 3 out of 3.
    assert.deepEqual(events.map((event) => [event.current, event.total]), [[1, 3], [2, 3], [3, 3]]);
    // an empty file list gives no event.
    events.length = 0;
    getSessionDotIndex(PROJECT_DIR, [], recordEvent);
    assert.equal(events.length, 0);
});
