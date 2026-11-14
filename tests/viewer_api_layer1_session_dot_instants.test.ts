// GET /api/layer1-session-dot-instants: every session's dot instants over the whole index (task 907 step 7).

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { encodeProjectFolderName } from "../src/reconstruction_repo_discovery.ts";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { buildLayer1SessionDotInstants } from "../src/viewer_api_layer1_session_dot_instants.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { decodeSessionDotInstants } from "../webapp/layer1-components/session-column/layer1-wire-session-instants.ts";
import { writeSessionTranscript, SESSION_ONE, SESSION_TWO } from "./layer1-snapshot-wire-test-helpers.ts";
import { createFixtureDiskFolder } from "./layer1-view-test-helpers.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const TEN_O_CLOCK = "2026-07-01T10:00:00.000Z";
const ELEVEN_O_CLOCK = "2026-07-01T11:00:00.000Z";
const TWELVE_O_CLOCK = "2026-07-01T12:00:00.000Z";

function buildUserRecord(uuid: string, sessionId: string, instant: string): object {
    return { type: RecordType.user, uuid, sessionId, timestamp: instant, message: { role: "user", content: `at ${instant}` } };
}

function writeSessionLog(treeRoot: string, diskDir: string, sessionId: string, instants: string[]): string {
    const records: object[] = [];
    for (const [index, instant] of instants.entries()) {
        records.push(buildUserRecord(`${sessionId.slice(0, 8)}-0000-0000-0000-00000000000${index + 1}`, sessionId, instant));
    }
    const logFile = writeSessionTranscript(treeRoot, sessionId, records, encodeProjectFolderName(diskDir));
    return dirname(logFile.toString());
}

function askDotInstants(diskDir: string, logFolder: string): ReadonlyMap<string, readonly number[]> {
    const files = listTranscriptFiles([logFolder]);
    return decodeSessionDotInstants(buildLayer1SessionDotInstants(new Path(diskDir), files));
}

test("test_the_instants_answer_lists_one_entry_per_dot_per_session", () => {
    // Scenario: two session logs in one project give one ascending instant list per session.
    // session one logs three dots (written out of order) and session two logs one dot
    const diskDir = createFixtureDiskFolder();
    const treeRoot = createTempDir();
    writeSessionLog(treeRoot, diskDir, SESSION_ONE, [TWELVE_O_CLOCK, TEN_O_CLOCK, ELEVEN_O_CLOCK]);
    const logFolder = writeSessionLog(treeRoot, diskDir, SESSION_TWO, [ELEVEN_O_CLOCK]);
    // ask for the dot instants of the whole index
    const instants = askDotInstants(diskDir, logFolder);
    // session one has three instants, ascending
    assert.deepEqual(instants.get(SESSION_ONE), [Date.parse(TEN_O_CLOCK), Date.parse(ELEVEN_O_CLOCK), Date.parse(TWELVE_O_CLOCK)]);
    // session two has one instant
    assert.deepEqual(instants.get(SESSION_TWO), [Date.parse(ELEVEN_O_CLOCK)]);
});

test("test_equal_instants_in_one_session_repeat", () => {
    // Scenario: two dots of one session at the same instant stay two entries.
    // session one logs two dots at 10:00 and one dot at 11:00
    const diskDir = createFixtureDiskFolder();
    const logFolder = writeSessionLog(createTempDir(), diskDir, SESSION_ONE, [TEN_O_CLOCK, TEN_O_CLOCK, ELEVEN_O_CLOCK]);
    // ask for the dot instants of the whole index
    const instants = askDotInstants(diskDir, logFolder);
    // the 10:00 instant appears twice, then 11:00
    assert.deepEqual(instants.get(SESSION_ONE), [Date.parse(TEN_O_CLOCK), Date.parse(TEN_O_CLOCK), Date.parse(ELEVEN_O_CLOCK)]);
});
