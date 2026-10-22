// Task 355 step 6: the Edit form of /api/layer1-file; transcripts are temp files loaded through loadTranscript.

import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { buildEditsView } from "../src/layer1_edits_wire.ts";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { isEditFileRequest, readEditFileContent } from "../src/viewer_api_layer1_edit_file.ts";
import {
    SESSION_A, buildEditRecordPair, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

const HUNK = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-one", "+uno"] };
const PROJECT_FOLDER = makeTempDir();

function buildEnvelope(toolId: string, minute: number): { sessionId: string; cwd: string; timestamp: string; toolId: string; parentUuid: null } {
    return { sessionId: SESSION_A, cwd: PROJECT_FOLDER, timestamp: `2026-07-24T10:0${minute}:00.000Z`, toolId, parentUuid: null };
}

function buildTitle(title: string): object {
    return { type: RecordType.customTitle, sessionId: SESSION_A, customTitle: title };
}

// Lines: 1 title, 2-3 write, 4-5 edit, 6 later title.
function writeSession(): string {
    const tree = makeSourceTree("-edit-file");
    const filePath = join(PROJECT_FOLDER, "a.py");
    const write = buildWriteRecordPair(buildEnvelope("toolu_w1", 1), filePath, "one\n");
    const edit = buildEditRecordPair(buildEnvelope("toolu_e1", 2), filePath, "uno\n", "one\n", HUNK);
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [buildTitle("First"), ...write.records, ...edit.records, buildTitle("Later")]);
    return tree.projectDir;
}

function buildQuery(sessionFolder: string, changeId: string, side: string): URLSearchParams {
    return new URLSearchParams({ editChangeId: changeId, side, path: "a.py", dir: PROJECT_FOLDER, jsonl: sessionFolder });
}

test("test_edit_file_side_base_and_target_differ_by_the_patch", () => {
    const folder = writeSession();
    assert.equal(readEditFileContent(buildQuery(folder, "toolu_e1", "base")).content, "one");
    assert.equal(readEditFileContent(buildQuery(folder, "toolu_e1", "target")).content, "uno");
    assert.equal(isEditFileRequest(buildQuery(folder, "toolu_e1", "base")), true);
    assert.equal(isEditFileRequest(new URLSearchParams({ path: "a.py" })), false);
});

test("test_edit_file_content_equals_replay_used_for_confidence", () => {
    const folder = writeSession();
    const writeTarget = readEditFileContent(buildQuery(folder, "toolu_w1", "target")).content;
    assert.equal(readEditFileContent(buildQuery(folder, "toolu_e1", "base")).content, writeTarget);
    const [pair] = buildEditsView(new Path(PROJECT_FOLDER), [new Path(join(folder, "a.jsonl"))]).pairs;
    assert.equal(pair!.edits[1]!.confidence, "verified");
});

test("test_edit_file_returns_result_record_with_structured_patch", () => {
    const { record } = readEditFileContent(buildQuery(writeSession(), "toolu_e1", "base"));
    const revealed = JSON.parse(JSON.stringify(record)) as { toolUseResult: { structuredPatch: unknown } };
    assert.deepEqual(revealed.toolUseResult.structuredPatch, [HUNK]);
});

test("test_edit_file_title_is_session_title_at_line", () => {
    const folder = writeSession();
    assert.equal(readEditFileContent(buildQuery(folder, "toolu_e1", "base")).title, "First");
});

test("test_edit_file_unknown_change_id_throws", () => {
    assert.throws(() => readEditFileContent(buildQuery(writeSession(), "toolu_nope", "base")), /no edit event toolu_nope/);
});

test("test_edit_file_bad_side_throws", () => {
    assert.throws(() => readEditFileContent(buildQuery(writeSession(), "toolu_e1", "middle")), /side must be base or target/);
});
