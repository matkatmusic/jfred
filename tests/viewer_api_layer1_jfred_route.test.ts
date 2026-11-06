// Task 361 phase 4: the jfred commit and delete routes, called with stand-in request and response objects.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { before, describe, test } from "node:test";
import { clearBuiltDocumentCache } from "../src/viewer_api.ts";
import { getPathOverrides, setPathOverrides } from "../src/reconstruction_overrides.ts";
import { setFileHistoryDir } from "../src/viewer_api_projects.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { enableJfredWrites, receiveJfredCommit, receiveJfredDelete } from "../src/viewer_api_layer1_jfred_route.ts";
import { JFRED_SUBJECT_PREFIX, JfredCommitOutcome } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildEditRecordPair, buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";
import { createJfredTempRepo, snapshotRepoState } from "./jfred-write-test-helpers.ts";

const PORT = 7431;
const FIRST_WRITE_AT = "2026-07-01T17:00:00.000Z";
const MARK_AT = "2026-07-01T20:00:00.000Z";
const SECOND_WRITE_AT = "2026-07-02T10:00:00.000Z";

function postRoute(handler: typeof receiveJfredCommit, query: Record<string, string>, body: object, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
    return new Promise((resolve) => {
        const request = Object.assign(Readable.from([JSON.stringify(body)]), { headers: { "content-type": "application/json", host: `127.0.0.1:${PORT}`, ...headers }, socket: { localPort: PORT } });
        let status = 0;
        let text = "";
        const socket = { destroyed: false, writable: true, setNoDelay() {}, uncork() {} };
        const response = { socket, destroyed: false, writableCorked: 0, uncork() {}, writeHead(code: number) { status = code; }, write(chunk: string) { text += chunk; }, end(chunk?: string) { text += chunk ?? ""; resolve({ status, text }); } };
        handler(request as unknown as IncomingMessage, response as unknown as ServerResponse, new URL(`http://127.0.0.1:${PORT}/route?${new URLSearchParams(query)}`));
    });
}

function readGit(repoDir: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
}

// A write without content writes the parent commit's a.txt, so the text at the mark equals the parent.
function createFixture(writes: [string, string?][]) {
    const { repoDir, commitHashes } = createJfredTempRepo();
    const baseShortHash = commitHashes[1]!.slice(0, 8);
    const tree = createSourceTree("-jfred-route");
    const records: object[] = [];
    for (const [index, [timestamp, content]] of writes.entries()) {
        const envelope = { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp, toolId: `toolu_w${index}`, parentUuid: null };
        records.push(...buildWriteRecordPair(envelope, join(tree.treeRoot, "a.txt"), content ?? readGit(repoDir, "show", `${baseShortHash}:a.txt`)).records);
    }
    writeTranscriptFixture(tree.projectDir, "a.jsonl", records);
    clearBuiltDocumentCache();
    return { repoDir, baseShortHash, projectDir: tree.treeRoot, transcriptFolder: tree.projectDir };
}

const BACKUP_NAME = "bk@v1";
const BACKUP_TEXT = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n";
const TEXT_AFTER_EDIT = "line 1\nline 2\nline 3\nline 4\nfive\nline 6\nline 7\nline 8\nline 9\nline 10\n";
const SNAPSHOT_AT = "2026-07-01T16:00:00.000Z";

// One Edit with no Write: the engine takes its base text from the page's backup blob.
function createBackupEditFixture() {
    const { repoDir, commitHashes } = createJfredTempRepo();
    const tree = createSourceTree("-jfred-route-backup");
    const blobFolder = join(tree.treeRoot, "file-history", SESSION_A);
    mkdirSync(blobFolder, { recursive: true });
    writeFileSync(join(blobFolder, BACKUP_NAME), BACKUP_TEXT);
    const filePath = join(tree.treeRoot, "a.txt");
    const backup = { backupFileName: BACKUP_NAME, version: 1, backupTime: SNAPSHOT_AT };
    const snapshot = { messageId: "m-snapshot", timestamp: SNAPSHOT_AT, trackedFileBackups: { [filePath]: backup } };
    const snapshotRecord = { type: RecordType.fileHistorySnapshot, messageId: "m-snapshot", isSnapshotUpdate: false, snapshot };
    const envelope = { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp: FIRST_WRITE_AT, toolId: "toolu_e0", parentUuid: null };
    // The hunk shows lines 2 to 8; lines 1, 9 and 10 come only from the blob.
    const hunk = { oldStart: 2, oldLines: 7, newStart: 2, newLines: 7, lines: [" line 2", " line 3", " line 4", "-line 5", "+five", " line 6", " line 7", " line 8"] };
    const edit = buildEditRecordPair(envelope, filePath, "not used\n", null, hunk);
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [snapshotRecord, ...edit.records]);
    clearBuiltDocumentCache();
    return { repoDir, baseShortHash: commitHashes[1]!.slice(0, 8), projectDir: tree.treeRoot, transcriptFolder: tree.projectDir, blobRoot: join(tree.treeRoot, "file-history") };
}

const FAILED_EDIT_AT = "2026-07-01T18:00:00.000Z";

// An empty hunk makes replay throw; the optional second Write is the next beacon.
function createFailedEditFixture(hasLaterWrite: boolean) {
    const fixture = createFixture(hasLaterWrite ? [[FIRST_WRITE_AT, "first text\n"], [SECOND_WRITE_AT, "second text\n"]] : [[FIRST_WRITE_AT, "first text\n"]]);
    const filePath = join(fixture.projectDir, "a.txt");
    const envelope = { sessionId: SESSION_A, cwd: fixture.projectDir, timestamp: FAILED_EDIT_AT, toolId: "toolu_failed", parentUuid: null };
    const emptyHunk = { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines: [] };
    const failedEdit = buildEditRecordPair(envelope, filePath, "not used\n", null, emptyHunk);
    const transcriptPath = join(fixture.transcriptFolder, "a.jsonl");
    appendFileSync(transcriptPath, failedEdit.records.map((record) => `${JSON.stringify(record)}\n`).join(""));
    clearBuiltDocumentCache();
    return fixture;
}

function postCommit(fixture: { repoDir: string; baseShortHash: string; projectDir: string; transcriptFolder: string }, parentShortHash?: string) {
    const query = { dir: fixture.projectDir, repo: fixture.repoDir, jsonl: fixture.transcriptFolder };
    return postRoute(receiveJfredCommit, query, { baseShortHash: fixture.baseShortHash, parentShortHash, markInstant: MARK_AT, message: `${JFRED_SUBJECT_PREFIX}${MARK_AT}`, allowScripts: false });
}

function readLines(reply: { text: string }): Record<string, unknown>[] {
    return reply.text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("test_commit_route_refuses_when_writes_are_off", async () => {
    // Scenario: the flag is off, so the route answers 400 naming the flag and writes nothing.
    const fixture = createFixture([[FIRST_WRITE_AT, "first text\n"]]);
    const stateBefore = snapshotRepoState(fixture.repoDir);
    const reply = await postCommit(fixture);
    assert.equal(reply.status, 400);
    assert.match(reply.text, /--allow-jfred-writes/);
    assert.equal(snapshotRepoState(fixture.repoDir), stateBefore);
});

test("test_delete_route_refuses_when_writes_are_off", async () => {
    // Scenario: with the flag off, a jfred branch that exists is left alone.
    const { repoDir } = createJfredTempRepo();
    readGit(repoDir, "branch", "jfred");
    const stateBefore = snapshotRepoState(repoDir);
    const reply = await postRoute(receiveJfredDelete, { repo: repoDir }, {});
    assert.equal(reply.status, 400);
    assert.match(reply.text, /--allow-jfred-writes/);
    assert.equal(snapshotRepoState(repoDir), stateBefore);
});

describe("with writes on", () => {
    before(() => enableJfredWrites()); // the writes-off tests above ran first, in file order
    test("test_commit_route_refuses_a_non_json_content_type", async () => {
        // Scenario: a form-style post is refused before any body is read.
        await assert.rejects(postRoute(receiveJfredCommit, {}, {}, { "content-type": "text/plain" }), /content type must be/);
    });

    test("test_commit_route_refuses_a_foreign_host", async () => {
        // Scenario: a request addressed to another host is refused.
        await assert.rejects(postRoute(receiveJfredCommit, {}, {}, { host: "example.com:80" }), /host must be/);
    });

    test("test_commit_route_with_writes_on_commits_the_engine_text_at_the_mark_instant", async () => {
        // Scenario: two Writes surround the mark; the commit holds the first Write's text.
        const fixture = createFixture([[FIRST_WRITE_AT, "first text\n"], [SECOND_WRITE_AT, "second text\n"]]);
        const lastLine = readLines(await postCommit(fixture)).at(-1)!;
        assert.deepEqual([lastLine.outcome, (lastLine.commit as { instant: string }).instant], [JfredCommitOutcome.committed, MARK_AT]);
        assert.equal(readGit(fixture.repoDir, "show", "jfred:a.txt"), "first text\n");
    });

    test("test_commit_build_ignores_the_shared_setting_of_another_project", async () => {
        // Scenario: another page left the shared setting on an empty folder; the commit still reads this page's blobs.
        const fixture = createBackupEditFixture();
        const emptyFolder = mkdtempSync(join(tmpdir(), "jfred-other-project-"));
        const previousOverrides = getPathOverrides();
        setFileHistoryDir(fixture.blobRoot);
        setPathOverrides({ fileHistoryRoot: new Path(emptyFolder), repoDir: new Path(emptyFolder) });
        try {
            const lastLine = readLines(await postCommit(fixture)).at(-1)!;
            assert.equal(lastLine.outcome, JfredCommitOutcome.committed);
            assert.equal(readGit(fixture.repoDir, "show", "jfred:a.txt"), TEXT_AFTER_EDIT);
        }
        finally {
            setPathOverrides(previousOverrides);
            setFileHistoryDir("");
        }
    });

    test("test_commit_route_replies_unchanged_with_the_next_changing_instant", async () => {
        // Scenario: the text at the mark equals the parent's file, so nothing is written.
        const fixture = createFixture([[FIRST_WRITE_AT], [SECOND_WRITE_AT, "second text\n"]]);
        const stateBefore = snapshotRepoState(fixture.repoDir);
        assert.deepEqual(readLines(await postCommit(fixture)).at(-1), { outcome: JfredCommitOutcome.unchanged, nextInstant: SECOND_WRITE_AT });
        assert.equal(snapshotRepoState(fixture.repoDir), stateBefore);
    });

    test("test_unrebuilt_reply_writes_no_jfred_ref", async () => {
        // Scenario: a failed Edit and a later Write give an unrebuilt reply; nothing is written.
        const fixture = createFailedEditFixture(true);
        const stateBefore = snapshotRepoState(fixture.repoDir);
        assert.deepEqual(readLines(await postCommit(fixture)).at(-1), { outcome: JfredCommitOutcome.unrebuilt, paths: ["a.txt"], nextInstant: SECOND_WRITE_AT });
        assert.equal(snapshotRepoState(fixture.repoDir), stateBefore);
    });

    test("test_unknown_file_with_no_later_beacon_throws_and_names_the_file", async () => {
        // Scenario: a failed Edit with no later beacon ends the stream with an error naming the file.
        const fixture = createFailedEditFixture(false);
        const stateBefore = snapshotRepoState(fixture.repoDir);
        const lastLine = readLines(await postCommit(fixture)).at(-1)!;
        assert.equal(lastLine.kind, DocumentResponseKind.error);
        assert.match(String(lastLine.label), /jfred commit stopped: the engine could not rebuild a\.txt at 2026-07-01T20:00:00\.000Z/);
        assert.equal(snapshotRepoState(fixture.repoDir), stateBefore);
    });

    test("test_commit_route_replies_unchanged_without_a_next_instant_when_no_later_change_exists", async () => {
        // Scenario: the text at the mark equals the parent's file and no Write follows.
        assert.deepEqual(readLines(await postCommit(createFixture([[FIRST_WRITE_AT]]))).at(-1), { outcome: JfredCommitOutcome.unchanged });
    });

    test("test_commit_route_streams_progress_lines_before_the_reply", async () => {
        // Scenario: the engine's stages arrive as progress lines, then the reply is the last line.
        const lines = readLines(await postCommit(createFixture([[FIRST_WRITE_AT, "first text\n"]])));
        const kindsBeforeReply = new Set(lines.slice(0, -1).map((line) => line.kind));
        assert.deepEqual([...kindsBeforeReply], [DocumentResponseKind.progress]);
        assert.equal(lines.at(-1)!.outcome, JfredCommitOutcome.committed);
    });

    test("test_commit_route_ends_with_an_error_line_when_the_engine_fails", async () => {
        // Scenario: an unreadable transcript makes the build throw after the headers, so one error line ends the stream.
        const fixture = createFixture([[FIRST_WRITE_AT, "first text\n"]]);
        chmodSync(join(fixture.transcriptFolder, "a.jsonl"), 0);
        const lastLine = readLines(await postCommit(fixture)).at(-1)!;
        assert.equal(lastLine.kind, DocumentResponseKind.error);
        assert.match(String(lastLine.label), /EACCES/);
    });

    test("test_commit_route_ends_with_an_error_line_for_a_stale_parent", async () => {
        // Scenario: a second commit names the base as parent after the branch moved, so it is refused.
        const fixture = createFixture([[FIRST_WRITE_AT, "first text\n"]]);
        await postCommit(fixture);
        const lastLine = readLines(await postCommit(fixture, fixture.baseShortHash)).at(-1)!;
        assert.equal(lastLine.kind, DocumentResponseKind.error);
        assert.match(String(lastLine.label), /stale parent/);
    });

    test("test_delete_route_with_writes_on_removes_the_branch", async () => {
        // Scenario: after one commit the jfred branch exists; the delete route removes it.
        const fixture = createFixture([[FIRST_WRITE_AT, "first text\n"]]);
        await postCommit(fixture);
        const reply = await postRoute(receiveJfredDelete, { repo: fixture.repoDir }, {});
        assert.deepEqual([reply.status, JSON.parse(reply.text)], [200, { deleted: true }]);
        assert.equal(readGit(fixture.repoDir, "for-each-ref", "refs/heads/jfred"), "");
    });
});
