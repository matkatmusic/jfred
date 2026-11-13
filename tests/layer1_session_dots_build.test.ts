// Task 888 step 16: one log's records become dots in file order, with titles, ids, session ids and stampless borrowing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { buildFileSessionDots } from "../src/layer1_session_dots_build.ts";
import type { Layer1WireAnnotation } from "../src/layer1_session_dots_types.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { SESSION_ONE, SESSION_TWO, writeSessionTranscript } from "./layer1-snapshot-wire-test-helpers.ts";

const FIRST_INSTANT = "2026-07-01T11:00:00.000Z";
const SECOND_INSTANT = "2026-07-01T11:05:00.000Z";

function buildUserRecord(overrides: object): object {
    return { type: RecordType.user, sessionId: SESSION_ONE, message: { role: "user", content: "hello" }, ...overrides };
}

function buildDotsOfFile(file: Path): Layer1WireAnnotation[] {
    const records = loadTranscript(file.toString(), undefined, true).records;
    return buildFileSessionDots(records, file);
}

function buildDotsOfRecords(records: object[], sessionId: string = SESSION_ONE): { file: Path; dots: Layer1WireAnnotation[] } {
    const file = writeSessionTranscript(createTempDir(), sessionId, records);
    return { file, dots: buildDotsOfFile(file) };
}

test("test_each_record_makes_one_dot_with_its_file_and_one_based_raw_line", () => {
    // Write a log by hand: record, blank line, record.
    const file = new Path(join(createTempDir(), `${SESSION_ONE}.jsonl`));
    const firstLine = JSON.stringify(buildUserRecord({ timestamp: FIRST_INSTANT }));
    const secondLine = JSON.stringify(buildUserRecord({ timestamp: SECOND_INSTANT }));
    writeFileSync(file.toString(), `${firstLine}\n\n${secondLine}\n`);
    // Build the dots of the log.
    const dots = buildDotsOfFile(file);
    // One dot per record; the blank line keeps the real line numbers 1 and 3.
    assert.deepEqual(dots.map((dot) => dot.line), [1, 3]);
    assert.deepEqual(dots.map((dot) => dot.sessionFile), [file.toString(), file.toString()]);
});

test("test_a_dot_carries_the_record_uuid_as_its_id", () => {
    // A record has a uuid.
    const recordUuid = "aaaaaaaa-0000-0000-0000-000000000001";
    const { dots } = buildDotsOfRecords([buildUserRecord({ uuid: recordUuid, timestamp: FIRST_INSTANT })]);
    // The dot id is that uuid.
    assert.equal(dots[0]!.id.toString(), recordUuid);
});

test("test_a_record_without_a_uuid_gets_an_id_made_from_file_and_line", () => {
    // A record has no uuid.
    const { file, dots } = buildDotsOfRecords([buildUserRecord({ timestamp: FIRST_INSTANT })]);
    // The dot id is the file path, a colon, and the line.
    assert.equal(dots[0]!.id.toString(), `${file.toString()}:1`);
});

test("test_a_stampless_record_borrows_the_previous_stamped_instant_and_is_flagged", () => {
    // A stamped record is followed by a record with no timestamp.
    const { dots } = buildDotsOfRecords([
        buildUserRecord({ timestamp: FIRST_INSTANT }),
        buildUserRecord({}),
    ]);
    // The second dot takes the first dot's instant and is flagged stampless.
    assert.equal(dots[1]!.instant.toISOString(), FIRST_INSTANT);
    assert.equal(dots[1]!.isStampless, true);
});

test("test_a_stampless_record_before_any_stamped_record_is_dropped", () => {
    // A record with no timestamp comes first, then a stamped record.
    const { dots } = buildDotsOfRecords([
        buildUserRecord({}),
        buildUserRecord({ timestamp: FIRST_INSTANT }),
    ]);
    // Only the stamped record (line 2) makes a dot.
    assert.deepEqual(dots.map((dot) => dot.line), [2]);
});

test("test_a_stamped_record_is_not_flagged_stampless", () => {
    // A record has a timestamp.
    const { dots } = buildDotsOfRecords([buildUserRecord({ timestamp: FIRST_INSTANT })]);
    // The dot keeps that instant and is not flagged.
    assert.equal(dots[0]!.instant.toISOString(), FIRST_INSTANT);
    assert.notEqual(dots[0]!.isStampless, true);
});

test("test_the_dot_uses_the_record_session_id_else_the_file_session_id_else_the_file_name", () => {
    // A record with its own session id, then a record with none, in a file named for another session.
    const { dots: namedDots } = buildDotsOfRecords([
        buildUserRecord({ sessionId: SESSION_TWO, timestamp: FIRST_INSTANT }),
        buildUserRecord({ sessionId: undefined, timestamp: SECOND_INSTANT }),
    ], SESSION_ONE);
    // The first dot uses its own id; the second uses the first session id found in the file.
    assert.equal(namedDots[0]!.sessionId.toString(), SESSION_TWO);
    assert.equal(namedDots[1]!.sessionId.toString(), SESSION_TWO);
    // A file where no record has a session id falls back to the file name.
    const { dots: unnamedDots } = buildDotsOfRecords([buildUserRecord({ sessionId: undefined, timestamp: FIRST_INSTANT })], SESSION_ONE);
    assert.equal(unnamedDots[0]!.sessionId.toString(), SESSION_ONE);
});

test("test_the_dot_title_is_the_custom_title_in_effect_at_its_line", () => {
    // Records: user (line 1), custom-title first (line 2), user (line 3), custom-title second (line 4), user (line 5).
    const { dots } = buildDotsOfRecords([
        buildUserRecord({ timestamp: FIRST_INSTANT }),
        { type: RecordType.customTitle, sessionId: SESSION_ONE, customTitle: "first", timestamp: FIRST_INSTANT },
        buildUserRecord({ timestamp: SECOND_INSTANT }),
        { type: RecordType.customTitle, sessionId: SESSION_ONE, customTitle: "second", timestamp: SECOND_INSTANT },
        buildUserRecord({ timestamp: SECOND_INSTANT }),
    ]);
    // The user dots at lines 1, 3 and 5 carry no title, "first" and "second".
    const userDots = dots.filter((dot) => dot.kind === WireRecordKind.user);
    assert.deepEqual(userDots.map((dot) => dot.line), [1, 3, 5]);
    assert.deepEqual(userDots.map((dot) => dot.sessionTitle), ["", "first", "second"]);
});

test("test_pair_ids_and_kinds_come_from_the_description_step", () => {
    // A tool_use record is followed by its tool_result record.
    const toolUseRecord = {
        type: RecordType.assistant,
        sessionId: SESSION_ONE,
        timestamp: FIRST_INSTANT,
        message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }] },
    };
    const toolResultRecord = buildUserRecord({
        timestamp: SECOND_INSTANT,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }] },
    });
    const { dots } = buildDotsOfRecords([toolUseRecord, toolResultRecord]);
    // The two dots have the tool kinds and the same pair id.
    assert.equal(dots[0]!.kind, WireRecordKind.toolUse);
    assert.equal(dots[1]!.kind, WireRecordKind.toolResult);
    assert.equal(dots[0]!.pairId!.toString(), "toolu_1");
    assert.equal(dots[1]!.pairId!.toString(), "toolu_1");
});
