import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Uuid } from "../src/structures/domain.ts";
import { loadJSONLLineIndex } from "./engineV3_jsonl_line_index.ts";
import { collectBashCallResults } from "./engineV3_replay_bash_results.ts";
import { collectNewOutputUuids, getRecordedUuidEnv, listUuidsInText } from "./engineV3_replay_new_uuids.ts";
import { ignorePhaseProgress } from "./engineV3_startup_progress.ts";

const SESSION_ID = "7d31cfda-fb91-4f61-ba61-7031cb5484e2";
const OTHER_SESSION_ID = "5c1f6f0e-2a3b-4c5d-9e8f-0a1b2c3d4e5f";
const CALL_ID = "toolu_01NewUuidCall";
const SECOND_CALL_ID = "toolu_01SecondNewUuidCall";
const MADE_UUID = "a8da816e-4851-4ad7-bf1d-6e99d7555fdf";
const LISTED_UUID = "3f2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-new-uuids-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeCallLine(sessionId: string, toolUseId: string, command: string, timestamp: string): object {
    const block = { type: "tool_use", id: toolUseId, name: "Bash", input: { command, description: "test" } };
    return { type: "assistant", uuid: `${toolUseId}-call`, parentUuid: null, cwd: "/tmp", timestamp, sessionId, message: { role: "assistant", content: [block] } };
}

function makeResultLine(sessionId: string, toolUseId: string, output: string, timestamp: string): object {
    const block = { type: "tool_result", tool_use_id: toolUseId, content: output };
    return { type: "user", uuid: `${toolUseId}-result`, parentUuid: `${toolUseId}-call`, cwd: "/tmp", timestamp, sessionId, message: { role: "user", content: [block] } };
}

function writeJSONLFile(folder: string, fileName: string, fixtureLines: object[]): void {
    writeFileSync(join(folder, fileName), fixtureLines.map((fixtureLine) => JSON.stringify(fixtureLine)).join("\n") + "\n");
}

// Loads every JSONL file of the folder the way the replay loads them and collects the new uuids of each Bash call.
function collectNewUuidsOfFolder(folder: string): Map<string, Uuid[]> {
    const indexLines = loadJSONLLineIndex([folder]).indexLines;
    return collectNewOutputUuids(indexLines, collectBashCallResults(indexLines), ignorePhaseProgress);
}

function listUuidTexts(uuids: Uuid[] | undefined): string[] | undefined {
    if (uuids === undefined) {
        return undefined;
    }
    const uuidTexts: string[] = [];
    for (const uuid of uuids) {
        uuidTexts.push(uuid.toString());
    }
    return uuidTexts;
}

test("test_listUuidsInText_lists_each_random_uuid_once_in_order_of_first_appearance", () => {
    // Scenario: the hand-out order is the order the Mac printed the uuids.
    // the text names MADE_UUID, then LISTED_UUID, then MADE_UUID again, and a version 1 uuid that randomUUID never makes
    const text = `made ${MADE_UUID}\nlisted ${LISTED_UUID}\nagain ${MADE_UUID}\nold 6ba7b810-9dad-11d1-80b4-00c04fd430c8`;
    // the list holds MADE_UUID then LISTED_UUID, once each
    assert.deepEqual(listUuidTexts(listUuidsInText(text)), [MADE_UUID, LISTED_UUID]);
});

test("test_collectNewOutputUuids_keeps_a_uuid_first_seen_in_the_call_output", (t) => {
    // Scenario: `bun demo/makeSession.ts` printed the uuid it made, and no earlier line holds it.
    const folder = makeTempFolder(t);
    // the call prints MADE_UUID
    writeJSONLFile(folder, `${SESSION_ID}.jsonl`, [
        makeCallLine(SESSION_ID, CALL_ID, "bun demo/makeSession.ts", "2026-10-06T15:10:18.000Z"),
        makeResultLine(SESSION_ID, CALL_ID, `57 messages -> demo/sessions/${MADE_UUID}.json`, "2026-10-06T15:10:19.000Z"),
    ]);
    // the call gets MADE_UUID
    assert.deepEqual(listUuidTexts(collectNewUuidsOfFolder(folder).get(CALL_ID)), [MADE_UUID]);
});

test("test_collectNewOutputUuids_leaves_out_a_uuid_in_the_command_text", (t) => {
    // Scenario: a uuid the command names already exists, so handing it out would reuse an existing id.
    const folder = makeTempFolder(t);
    // the command names MADE_UUID and the output prints it
    writeJSONLFile(folder, `${SESSION_ID}.jsonl`, [
        makeCallLine(SESSION_ID, CALL_ID, `cat demo/sessions/${MADE_UUID}.json`, "2026-10-06T15:10:18.000Z"),
        makeResultLine(SESSION_ID, CALL_ID, `{"sessionId":"${MADE_UUID}"}`, "2026-10-06T15:10:19.000Z"),
    ]);
    // the call gets no entry
    assert.equal(collectNewUuidsOfFolder(folder).has(CALL_ID), false);
});

test("test_collectNewOutputUuids_leaves_out_a_uuid_printed_earlier_in_another_session_file", (t) => {
    // Scenario: `ls demo/sessions; bun makeSession.ts` lists a file an earlier session made; that name must not go to the new file.
    const folder = makeTempFolder(t);
    // an earlier session printed LISTED_UUID
    writeJSONLFile(folder, `${OTHER_SESSION_ID}.jsonl`, [
        makeCallLine(OTHER_SESSION_ID, SECOND_CALL_ID, "bun demo/makeSession.ts", "2026-10-06T14:00:00.000Z"),
        makeResultLine(OTHER_SESSION_ID, SECOND_CALL_ID, `demo/sessions/${LISTED_UUID}.json`, "2026-10-06T14:00:01.000Z"),
    ]);
    // the later call lists LISTED_UUID and prints the new MADE_UUID
    writeJSONLFile(folder, `${SESSION_ID}.jsonl`, [
        makeCallLine(SESSION_ID, CALL_ID, "ls demo/sessions; bun demo/makeSession.ts", "2026-10-06T15:10:18.000Z"),
        makeResultLine(SESSION_ID, CALL_ID, `${LISTED_UUID}.json\n57 messages -> demo/sessions/${MADE_UUID}.json`, "2026-10-06T15:10:19.000Z"),
    ]);
    // the later call gets only MADE_UUID
    assert.deepEqual(listUuidTexts(collectNewUuidsOfFolder(folder).get(CALL_ID)), [MADE_UUID]);
});

test("test_collectNewOutputUuids_gives_a_uuid_only_to_the_first_of_two_parallel_calls", (t) => {
    // Scenario: two calls of one turn both start before either result, and both print MADE_UUID.
    const folder = makeTempFolder(t);
    writeJSONLFile(folder, `${SESSION_ID}.jsonl`, [
        makeCallLine(SESSION_ID, CALL_ID, "bun demo/makeSession.ts", "2026-10-06T15:10:18.000Z"),
        makeCallLine(SESSION_ID, SECOND_CALL_ID, "ls demo/sessions", "2026-10-06T15:10:18.500Z"),
        makeResultLine(SESSION_ID, CALL_ID, `demo/sessions/${MADE_UUID}.json`, "2026-10-06T15:10:19.000Z"),
        makeResultLine(SESSION_ID, SECOND_CALL_ID, `${MADE_UUID}.json`, "2026-10-06T15:10:19.500Z"),
    ]);
    const newUuids = collectNewUuidsOfFolder(folder);
    // the first call gets MADE_UUID
    assert.deepEqual(listUuidTexts(newUuids.get(CALL_ID)), [MADE_UUID]);
    // the second call gets no entry
    assert.equal(newUuids.has(SECOND_CALL_ID), false);
});

test("test_collectNewOutputUuids_gives_no_entry_for_a_call_with_no_uuid_in_its_output", (t) => {
    // Scenario: most calls print no uuid, so they run exactly as before.
    const folder = makeTempFolder(t);
    writeJSONLFile(folder, `${SESSION_ID}.jsonl`, [
        makeCallLine(SESSION_ID, CALL_ID, "echo hello", "2026-10-06T15:10:18.000Z"),
        makeResultLine(SESSION_ID, CALL_ID, "hello", "2026-10-06T15:10:19.000Z"),
    ]);
    // the call gets no entry
    assert.equal(collectNewUuidsOfFolder(folder).has(CALL_ID), false);
});

test("test_getRecordedUuidEnv_gives_no_env_to_a_call_with_no_new_uuid", () => {
    // Scenario: the preload is set only for a call whose recorded output holds a new uuid.
    assert.deepEqual(getRecordedUuidEnv(undefined), {});
});
