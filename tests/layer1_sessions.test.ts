// Task 311 (spec S19): buildSessionMetadata + titleInEffectAtLine. Temp-tree fixtures load via loadTranscript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { buildSessionMetadata, titleInEffectAtLine } from "../src/layer1_sessions.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

const SESSION_ID = "b21d84c5-0000-0000-0000-000000000001";

function userRecord(timestamp: string): object {
    return {
        type: RecordType.user,
        sessionId: SESSION_ID,
        cwd: "/repo",
        timestamp,
        message: { role: "user", content: "hi" },
    };
}

function titleRecord(title: string): object {
    return { type: RecordType.customTitle, sessionId: SESSION_ID, customTitle: title };
}

function writeRecord(timestamp: string, filePath: string): object {
    return {
        type: RecordType.assistant,
        sessionId: SESSION_ID,
        cwd: "/repo",
        timestamp,
        message: {
            id: "m1",
            content: [{ type: BlockType.tool_use, id: "t1", name: "Write", input: { file_path: filePath, content: "x\n" } }],
        },
    };
}

function writeSession(records: object[]): Path {
    const jsonlPath = join(makeTempDir(), `${SESSION_ID}.jsonl`);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return new Path(jsonlPath);
}

// Lines 1-2 unnamed, "first pass" from line 3, "second pass" from line 5.
function buildTwoTitleSession(): Path {
    return writeSession([
        userRecord("2026-06-01T14:05:00.000Z"),
        userRecord("2026-06-01T14:06:00.000Z"),
        titleRecord("first pass"),
        userRecord("2026-06-01T14:07:00.000Z"),
        titleRecord("second pass"),
        userRecord("2026-06-03T18:40:00.000Z"),
    ]);
}

test("test_two_title_session_returns_a_range_per_rename", () => {
    // Scenario: a session renamed part-way through keeps BOTH ranges — the builder never dedupes.
    const [session] = buildSessionMetadata([buildTwoTitleSession()]);
    assert.deepEqual(session!.titles, [
        { fromLine: 3, title: "first pass" },
        { fromLine: 5, title: "second pass" },
    ]);
});

test("test_title_in_effect_picks_the_range_the_line_falls_in", () => {
    // Scenario: a snapshot at line 4 belongs to the first title, one at line 6 to the second.
    const [session] = buildSessionMetadata([buildTwoTitleSession()]);
    assert.equal(titleInEffectAtLine(session!.titles, 4), "first pass");
    assert.equal(titleInEffectAtLine(session!.titles, 6), "second pass");
});

test("test_title_before_the_first_custom_title_record_is_undefined", () => {
    // Scenario: line 1 precedes every rename, so the session was not yet named there.
    const [session] = buildSessionMetadata([buildTwoTitleSession()]);
    assert.equal(titleInEffectAtLine(session!.titles, 1), undefined);
});

test("test_unnamed_session_yields_no_title_ranges", () => {
    const session = buildSessionMetadata([writeSession([userRecord("2026-07-20T15:38:00.000Z")])])[0];
    assert.deepEqual(session!.titles, []);
    assert.equal(titleInEffectAtLine(session!.titles, 5), undefined);
});

test("test_started_and_ended_are_the_first_and_last_record_instants", () => {
    // Scenario: the Nav band must open before the first write and close after the last one.
    const session = buildSessionMetadata([buildTwoTitleSession()])[0];
    assert.equal(session!.started?.toISOString(), "2026-06-01T14:05:00.000Z");
    assert.equal(session!.ended?.toISOString(), "2026-06-03T18:40:00.000Z");
});

test("test_paths_are_the_files_the_session_wrote", () => {
    const session = buildSessionMetadata([writeSession([
        userRecord("2026-07-23T19:10:00.000Z"),
        writeRecord("2026-07-23T19:11:00.000Z", "/repo/src/util.ts"),
    ])])[0];
    assert.deepEqual(session!.paths.map((path) => path.toString()), ["/repo/src/util.ts"]);
});
