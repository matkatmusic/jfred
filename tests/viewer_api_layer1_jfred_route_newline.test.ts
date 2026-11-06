// Task 361 phase 4: the commit route adds a final newline only if the latest copy had one.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { clearBuiltDocumentCache } from "../src/viewer_api.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { enableJfredWrites, receiveJfredCommit } from "../src/viewer_api_layer1_jfred_route.ts";
import { JFRED_SUBJECT_PREFIX } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { executeGitCommand, writeFileWithPinnedMtime } from "./layer1-view-test-helpers.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";
import { createJfredTempRepo } from "./jfred-write-test-helpers.ts";

const PORT = 7432;
const THIRD_COMMIT_AT = "2026-07-01T16:00:00Z";
const WRITE_AT = "2026-07-01T17:00:00.000Z";
const SNAPSHOT_AT = "2026-07-01T18:00:00.000Z";
const MARK_AT = "2026-07-01T20:00:00.000Z";
const BLOB_NAME = "abc123@v1";

function postCommit(query: Record<string, string>, body: object): Promise<void> {
    return new Promise((resolve) => {
        const request = Object.assign(Readable.from([JSON.stringify(body)]), { headers: { "content-type": "application/json", host: `127.0.0.1:${PORT}` }, socket: { localPort: PORT } });
        const socket = { destroyed: false, writable: true, setNoDelay() {}, uncork() {} };
        const response = { socket, destroyed: false, writableCorked: 0, uncork() {}, writeHead() {}, write() {}, end() { resolve(); } };
        receiveJfredCommit(request as unknown as IncomingMessage, response as unknown as ServerResponse, new URL(`http://127.0.0.1:${PORT}/route?${new URLSearchParams(query)}`));
    });
}

// The mark comes after one Write; `prepare` shapes the file's older copies and may return extra transcript records.
async function commitFirstWrite(prepare: (repoDir: string, projectDir: string) => object[]): Promise<string> {
    enableJfredWrites();
    const { repoDir, commitHashes } = createJfredTempRepo();
    const tree = createSourceTree("-jfred-newline");
    const extraRecords = prepare(repoDir, tree.treeRoot);
    const envelope = { sessionId: SESSION_A, cwd: tree.treeRoot, timestamp: WRITE_AT, toolId: "toolu_w0", parentUuid: null };
    const write = buildWriteRecordPair(envelope, join(tree.treeRoot, "a.txt"), "first text\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...write.records, ...extraRecords]);
    clearBuiltDocumentCache();
    const body = { baseShortHash: commitHashes[1]!.slice(0, 8), markInstant: MARK_AT, message: `${JFRED_SUBJECT_PREFIX}${MARK_AT}` };
    await postCommit({ dir: tree.treeRoot, repo: repoDir, jsonl: tree.projectDir }, body);
    return execFileSync("git", ["show", "jfred:a.txt"], { cwd: repoDir, encoding: "utf8" });
}

function commitNewerCopyWithoutNewline(repoDir: string): object[] {
    writeFileSync(join(repoDir, "a.txt"), "no newline");
    executeGitCommand(repoDir, "add -A");
    executeGitCommand(repoDir, "commit -q -m third", THIRD_COMMIT_AT);
    return [];
}

function prepareSnapshotCopyWithoutNewline(repoDir: string, projectDir: string): object[] {
    mkdirSync(join(projectDir, "file-history", SESSION_A), { recursive: true });
    writeFileSync(join(projectDir, "file-history", SESSION_A, BLOB_NAME), "first text");
    const backup = { backupFileName: BLOB_NAME, version: 1, backupTime: SNAPSHOT_AT };
    const snapshot = { messageId: "m-snapshot", timestamp: SNAPSHOT_AT, trackedFileBackups: { [join(projectDir, "a.txt")]: backup } };
    return [{ type: RecordType.fileHistorySnapshot, messageId: "m-snapshot", isSnapshotUpdate: false, snapshot }];
}

test("test_commit_route_adds_the_final_newline_when_the_last_commit_copy_of_the_file_ended_with_one", async () => {
    // Scenario: the temp repo's a.txt ends with a newline and no newer copy exists.
    assert.equal(await commitFirstWrite(() => []), "first text\n");
});

test("test_commit_route_does_not_add_it_when_that_copy_had_none", async () => {
    // Scenario: a newer commit copy of a.txt lacks the final newline, so the committed file lacks it too.
    assert.equal(await commitFirstWrite(commitNewerCopyWithoutNewline), "first text");
});

test("test_commit_route_takes_the_newline_from_a_snapshot_copy_that_is_newer_than_the_commit_copy", async () => {
    // Scenario: a snapshot after the last commit has no final newline, so the committed file has none.
    assert.equal(await commitFirstWrite(prepareSnapshotCopyWithoutNewline), "first text");
});

test("test_commit_route_takes_the_newline_from_a_disk_file_whose_mtime_is_at_or_before_the_mark", async () => {
    // Scenario: a disk copy modified exactly at the mark has no final newline, so the committed file has none.
    const prepareDiskCopy = (repoDir: string, projectDir: string): object[] => {
        writeFileWithPinnedMtime(projectDir, "a.txt", "first text", MARK_AT);
        return [];
    };
    assert.equal(await commitFirstWrite(prepareDiskCopy), "first text");
});
