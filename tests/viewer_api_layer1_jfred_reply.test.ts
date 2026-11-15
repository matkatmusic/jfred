// Task 361 gap 606: a jfred Commit includes a recorded script run only when the page allowed scripts.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
// import { clearBuiltDocumentCache } from "../src/viewer_api.ts";
import { RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { parseCommitInput } from "../src/viewer_api_layer1_jfred_route.ts";
import { buildCommitReply } from "../src/viewer_api_layer1_jfred_reply.ts";
import { getInverseReposStoreFolder } from "../src/viewer_api_layer1_inverse_repos.ts";
import { JFRED_SUBJECT_PREFIX, JfredCommitOutcome } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";
// import { resetRunState } from "./layer1_run_test_helpers.ts";
import { SESSION_A, SESSION_B, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { createTempDir } from "./overrides-test-helpers.ts";
import { buildEditRecordPair, buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";

const WRITE_AT = "2026-07-01T17:00:00.000Z";
const SCRIPT_AT = "2026-07-01T18:00:00.000Z";
const MARK_AT = "2026-07-01T20:00:00.000Z";
const APPEND_Z_SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "z\\n")\n';

// // One Write of a.txt, then a recorded script run that appends a line to it.
// function createScriptFixture() {
//     const { repoDir, commitHashes } = createJfredTempRepo();
//     const tree = createSourceTree("-jfred-reply-script");
//     const envelope = { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp: WRITE_AT, toolId: "toolu_w0", parentUuid: null };
//     const write = buildWriteRecordPair(envelope, join(tree.treeRoot, "a.txt"), "first text\n");
//     const block = { type: "tool_use", id: "toolu_script", name: ToolName.CtxExecute, input: { cwd: tree.treeRoot, code: APPEND_Z_SCRIPT } };
//     const scriptRecord = { sessionId: SESSION_A, timestamp: SCRIPT_AT, cwd: tree.treeRoot, type: "assistant", uuid: "toolu_script-a", parentUuid: null, message: { role: "assistant", content: [block] } };
//     writeTranscriptFixture(tree.projectDir, "a.jsonl", [...write.records, scriptRecord]);
//     clearBuiltDocumentCache();
//     return { repoDir, baseShortHash: commitHashes[1]!.slice(0, 8), projectDir: tree.treeRoot, transcriptFolder: tree.projectDir };
// }

function buildInputBody(baseShortHash: string, allowScripts?: unknown, markAt: string = MARK_AT): string {
    return JSON.stringify({ baseShortHash, markInstant: markAt, message: `${JFRED_SUBJECT_PREFIX}${markAt}`, allowScripts });
}

// function commitScriptFixture(allowScripts: boolean): string {
//     resetRunState();
//     const fixture = createScriptFixture();
//     const query = new URLSearchParams({ dir: fixture.projectDir, repo: fixture.repoDir, jsonl: fixture.transcriptFolder });
//     const reply = buildCommitReply(parseCommitInput(query, buildInputBody(fixture.baseShortHash, allowScripts)), () => {});
//     assert.equal(reply.outcome, JfredCommitOutcome.committed);
//     return execFileSync("git", ["show", "jfred:a.txt"], { cwd: fixture.repoDir, encoding: "utf8" });
// }

// test("test_commit_with_consent_includes_the_script_change", () => {
//     // Scenario: scripts are allowed, so the commit holds the line the script appended.
//     assert.equal(commitScriptFixture(true), "first text\nz\n");
// });

// test("test_commit_without_consent_leaves_the_script_change_out", () => {
//     // Scenario: scripts are not allowed, so the commit holds only the Write's text.
//     assert.equal(commitScriptFixture(false), "first text\n");
// });

const LATER_AT = "2026-07-01T21:00:00.000Z";

interface MarkFixture {
    repoDir: string;
    baseShortHash: string;
    projectFolder: string;
    transcriptFolder: string;
    snapshotsFolder: string;
}

// The project folder holds a.txt as diskText; the log has one Write of a.txt per [instant, text] pair. The git repo holds "second\n" in a.txt.
function createMarkFixture(t: TestContext, writes: [string, string][], diskText: string, scriptRecordAt?: string): MarkFixture {
    const { repoDir, commitHashes } = createJfredTempRepo();
    const projectFolder = createTempDir();
    writeFileSync(join(projectFolder, "a.txt"), diskText);
    const tree = createSourceTree("-jfred-reply-mark");
    const records: object[] = [];
    for (const [index, [timestamp, text]] of writes.entries()) {
        const envelope = { sessionId: SESSION_A, cwd: projectFolder, timestamp, toolId: `toolu_w${index}`, parentUuid: null };
        records.push(...buildWriteRecordPair(envelope, join(projectFolder, "a.txt"), text).records);
    }
    if (scriptRecordAt !== undefined) {
        const block = { type: "tool_use", id: "toolu_script", name: ToolName.CtxExecute, input: { cwd: projectFolder, code: APPEND_Z_SCRIPT } };
        records.push({ sessionId: SESSION_A, timestamp: scriptRecordAt, cwd: projectFolder, type: "assistant", uuid: "toolu_script-a", parentUuid: null, message: { role: "assistant", content: [block] } });
    }
    writeTranscriptFixture(tree.projectDir, "a.jsonl", records);
    t.after(() => rmSync(getInverseReposStoreFolder(new Path(projectFolder)).toString(), { recursive: true, force: true }));
    return { repoDir, baseShortHash: commitHashes[1]!.slice(0, 8), projectFolder, transcriptFolder: tree.projectDir, snapshotsFolder: join(tree.treeRoot, "file-history") };
}

function buildMarkQuery(fixture: MarkFixture, snapshotsKey: string = "snapshots"): URLSearchParams {
    const query = new URLSearchParams({ dir: fixture.projectFolder, repo: fixture.repoDir, jsonl: fixture.transcriptFolder });
    query.append(snapshotsKey, fixture.snapshotsFolder);
    return query;
}

function commitAtMark(fixture: MarkFixture, markAt: string = MARK_AT, allowScripts: boolean = false) {
    const input = parseCommitInput(buildMarkQuery(fixture), buildInputBody(fixture.baseShortHash, allowScripts, markAt));
    return buildCommitReply(input, () => {});
}

function readJfredFile(repoDir: string, fileName: string): string {
    return execFileSync("git", ["show", `jfred:${fileName}`], { cwd: repoDir, encoding: "utf8" });
}

test("test_commit_builds_the_per_file_repos_before_it_reads_them", (t) => {
    // Scenario: the store folder of the project does not exist yet; the commit builds it and holds the bytes at the mark.
    const fixture = createMarkFixture(t, [[WRITE_AT, "first text\n"]], "first text\n");
    const storeFolder = getInverseReposStoreFolder(new Path(fixture.projectFolder)).toString();
    assert.equal(existsSync(storeFolder), false);
    const reply = commitAtMark(fixture);
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    assert.equal(existsSync(storeFolder), true);
    assert.equal(readJfredFile(fixture.repoDir, "a.txt"), "first text\n");
});

test("test_commit_holds_the_bytes_the_reader_returns_at_the_mark", (t) => {
    // Scenario: a.txt is written at 17:00 and again at 21:00; disk holds the 21:00 text; the mark is 20:00.
    const fixture = createMarkFixture(t, [[WRITE_AT, "first text\n"], [LATER_AT, "later text\n"]], "later text\n");
    const reply = commitAtMark(fixture);
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    assert.equal(readJfredFile(fixture.repoDir, "a.txt"), "first text\n");
});

test("test_commit_keeps_the_final_newline_of_the_reader_text", (t) => {
    // Scenario: the file text ends in one newline.
    const fixture = createMarkFixture(t, [[WRITE_AT, "line one\nline two\n"]], "line one\nline two\n");
    const reply = commitAtMark(fixture);
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    const committedText = readJfredFile(fixture.repoDir, "a.txt");
    assert.equal(committedText.endsWith("two\n"), true);
    assert.equal(committedText.endsWith("\n\n"), false);
});

test("test_commit_message_is_unchanged_when_no_file_is_behind_a_roadblock", (t) => {
    // Scenario: no file is behind a roadblock, so the commit message is the request message.
    const fixture = createMarkFixture(t, [[WRITE_AT, "first text\n"]], "first text\n");
    commitAtMark(fixture);
    const message = execFileSync("git", ["log", "-1", "--format=%B", "jfred"], { cwd: fixture.repoDir, encoding: "utf8" });
    assert.equal(message.trimEnd(), `${JFRED_SUBJECT_PREFIX}${MARK_AT}`);
});

test("test_unchanged_reply_holds_the_next_changing_instant_of_the_repos", (t) => {
    // Scenario: the text at the mark equals the parent commit text; a.txt changes at 21:00.
    const fixture = createMarkFixture(t, [[WRITE_AT, "second\n"], [LATER_AT, "later text\n"]], "later text\n");
    const reply = commitAtMark(fixture);
    assert.equal(reply.outcome, JfredCommitOutcome.unchanged);
    assert.equal((reply as { nextInstant: Date }).nextInstant.toISOString(), LATER_AT);
});

test("test_reply_never_runs_a_script", (t) => {
    // Scenario: a recorded script appends "z" to a.txt at 18:00; scripts are allowed; the commit holds only the Write text.
    const fixture = createMarkFixture(t, [[WRITE_AT, "first text\n"]], "first text\n", SCRIPT_AT);
    const reply = commitAtMark(fixture, MARK_AT, true);
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    assert.equal(readJfredFile(fixture.repoDir, "a.txt"), "first text\n");
});

test("test_commit_message_gets_the_not_proven_section_for_a_file_behind_a_roadblock", (t) => {
    // Scenario: a.txt is written at 17:00; a recorded script that was not replayed may write it at 18:00; disk holds a line that only the script can have added; the mark is 20:00.
    const fixture = createMarkFixture(t, [[WRITE_AT, "first text\n"]], "first text\nz\n", SCRIPT_AT);
    const reply = commitAtMark(fixture);
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    const message = execFileSync("git", ["log", "-1", "--format=%B", "jfred"], { cwd: fixture.repoDir, encoding: "utf8" });
    const expectedSection = [
        "Not proven: a recorded script was not replayed for these files. The bytes are the nearest older known bytes.",
        `- a.txt (bytes from ${WRITE_AT}, script at ${SCRIPT_AT})`,
    ].join("\n");
    assert.equal(message.trimEnd(), `${JFRED_SUBJECT_PREFIX}${MARK_AT}\n\n${expectedSection}`);
});

const BACKUP_NAME = "bk@v1";
const BACKUP_TEXT = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n";
const BACKUP_MARK_AT = "2026-07-01T17:30:00.000Z";
const EDIT_LINE_NUMBER_FOR_A = 5;
const EDIT_LINE_NUMBER_FOR_B = 6;

// One log folder with its own backup blob and one Edit whose hunk needs that blob.
function writeBackupEditSource(pageDir: string, sessionId: string, fileName: string, editedLineNumber: number): string {
    const tree = createSourceTree(`-jfred-reply-${fileName}`);
    const blobFolder = join(tree.treeRoot, "file-history", sessionId);
    mkdirSync(blobFolder, { recursive: true });
    writeFileSync(join(blobFolder, BACKUP_NAME), BACKUP_TEXT);
    const filePath = join(pageDir, fileName);
    const backup = { backupFileName: BACKUP_NAME, version: 1, backupTime: WRITE_AT };
    const snapshot = { messageId: `m-${fileName}`, timestamp: WRITE_AT, trackedFileBackups: { [filePath]: backup } };
    const snapshotRecord = { type: RecordType.fileHistorySnapshot, messageId: `m-${fileName}`, isSnapshotUpdate: false, snapshot };
    const envelope = { sessionId, cwd: pageDir, timestamp: SCRIPT_AT, toolId: `toolu_${fileName}`, parentUuid: null };
    const shownLines: string[] = [];
    for (let lineNumber = 2; lineNumber <= 8; lineNumber++) {
        if (lineNumber === editedLineNumber) {
            shownLines.push(`-line ${lineNumber}`, `+edited ${lineNumber}`);
        }
        else {
            shownLines.push(` line ${lineNumber}`);
        }
    }
    const hunk = { oldStart: 2, oldLines: 7, newStart: 2, newLines: 7, lines: shownLines };
    const edit = buildEditRecordPair(envelope, filePath, "not used\n", null, hunk);
    // The inverse repos find a backup blob by the log file name, so the log is named after its session.
    writeTranscriptFixture(tree.projectDir, `${sessionId}.jsonl`, [snapshotRecord, ...edit.records]);
    return tree.projectDir;
}

// test("test_commit_finds_backups_next_to_each_log_folder", () => {
//     // Scenario: two chats sit in two log folders; each folder's own file-history gives the full text of its file.
//     const { repoDir, commitHashes } = createJfredTempRepo();
//     const pageDir = createSourceTree("-jfred-reply-page").treeRoot;
//     const firstFolder = writeBackupEditSource(pageDir, SESSION_A, "a.txt", EDIT_LINE_NUMBER_FOR_A);
//     const secondFolder = writeBackupEditSource(pageDir, SESSION_B, "b.txt", EDIT_LINE_NUMBER_FOR_B);
//     clearBuiltDocumentCache();
//     const query = new URLSearchParams({ dir: pageDir, repo: repoDir });
//     query.append("jsonl", firstFolder);
//     query.append("jsonl", secondFolder);
//     const reply = buildCommitReply(parseCommitInput(query, buildInputBody(commitHashes[1]!.slice(0, 8), false)), () => {});
//     assert.equal(reply.outcome, JfredCommitOutcome.committed);
//     const expectedA = BACKUP_TEXT.replace("line 5", "edited 5");
//     const expectedB = BACKUP_TEXT.replace("line 6", "edited 6");
//     assert.equal(execFileSync("git", ["show", "jfred:a.txt"], { cwd: repoDir, encoding: "utf8" }), expectedA);
//     assert.equal(execFileSync("git", ["show", "jfred:b.txt"], { cwd: repoDir, encoding: "utf8" }), expectedB);
// });

test("test_commit_reads_snapshot_folders_from_the_snapshots_query_key", (t) => {
    // Scenario: a backup of a.txt is taken at 17:00 and an Edit runs at 18:00; the mark is 17:30, so only the backup blob in the snapshots folder holds the text.
    const { repoDir, commitHashes } = createJfredTempRepo();
    const projectFolder = createTempDir();
    t.after(() => rmSync(getInverseReposStoreFolder(new Path(projectFolder)).toString(), { recursive: true, force: true }));
    const transcriptFolder = writeBackupEditSource(projectFolder, SESSION_A, "a.txt", EDIT_LINE_NUMBER_FOR_A);
    const snapshotsFolder = join(transcriptFolder, "..", "..", "file-history");
    const query = new URLSearchParams({ dir: projectFolder, repo: repoDir, jsonl: transcriptFolder });
    query.append("snapshots", snapshotsFolder);
    const reply = buildCommitReply(parseCommitInput(query, buildInputBody(commitHashes[1]!.slice(0, 8), false, BACKUP_MARK_AT)), () => {});
    assert.equal(reply.outcome, JfredCommitOutcome.committed);
    assert.equal(readJfredFile(repoDir, "a.txt"), BACKUP_TEXT);
});

test("test_parseCommitInput_refuses_a_request_without_a_boolean_allowScripts", () => {
    // Scenario: a missing or non-boolean allowScripts is refused with an error naming the field.
    const query = new URLSearchParams({ dir: process.cwd(), repo: process.cwd() });
    assert.throws(() => parseCommitInput(query, buildInputBody("a1b2c3d4")), /allowScripts/);
    assert.throws(() => parseCommitInput(query, buildInputBody("a1b2c3d4", "yes")), /allowScripts/);
});
