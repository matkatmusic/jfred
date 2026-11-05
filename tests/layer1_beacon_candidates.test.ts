// Task 358 part B: candidates from four beacon sources.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeaconSource, listBeaconCandidates, type BeaconCandidate } from "../src/layer1_beacon_candidates.ts";
import { Path } from "../src/structures/domain.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildReadRecordPair, type RecordEnvelope } from "./tool-call-record-pair-builders.ts";

const COMPLETE_WINDOW = { startLine: 1, numLines: 1, totalLines: 1 };

function buildEnvelope(cwd: string, toolId: string, minute: number): RecordEnvelope {
    return { sessionId: SESSION_A, cwd, timestamp: `2026-07-24T10:0${minute}:00.000Z`, toolId, parentUuid: null };
}

function buildCatRecords(cwd: string, toolId: string, minute: number, content: string): object[] {
    const envelope = { sessionId: SESSION_A, cwd, timestamp: `2026-07-24T10:0${minute}:00.000Z` };
    return [
        { ...envelope, type: "assistant", uuid: `${toolId}-a`, parentUuid: null,
            message: { role: "assistant", content: [{ type: "tool_use", id: toolId, name: "Bash", input: { command: "cat notes.txt" } }] } },
        { ...envelope, type: "user", uuid: `${toolId}-r`, parentUuid: `${toolId}-a`,
            message: { role: "user", content: [{ tool_use_id: toolId, type: "tool_result", content }] },
            toolUseResult: { stdout: content, stderr: "", interrupted: false, isImage: false, noOutputExpected: false } },
    ];
}

function buildSnapshotRecord(backupTime: string): object {
    return { type: "file-history-snapshot", messageId: "m1", isSnapshotUpdate: false, snapshot: {
        messageId: "m1", timestamp: backupTime,
        trackedFileBackups: { "notes.txt": { backupFileName: "abc@v1", version: 1, backupTime } },
    } };
}

// A folder that is not a git repo: the commit source finds nothing.
function makeEmptyFolder(): string {
    return mkdtempSync(join(tmpdir(), "beacon-candidates-empty-"));
}

function makeRepoWithOneCommit(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "beacon-candidates-repo-"));
    const git = (command: string, date?: string): void => {
        const env = date === undefined ? process.env : { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
        execSync(`git -c user.name=t -c user.email=t@t ${command}`, { cwd: repoDir, stdio: "pipe", env });
    };
    git("init -q");
    writeFileSync(join(repoDir, "notes.txt"), "commit bytes\n");
    git("add notes.txt");
    git("commit -q -m one", "2026-07-01T10:00:00Z");
    return repoDir;
}

// Writes the session file and the sibling file-history blob; returns the tree and the session file path.
function writeSessionTree(records: object[]): { treeRoot: string; session: Path } {
    const tree = createSourceTree("-beacon-candidates");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", records);
    mkdirSync(join(tree.treeRoot, "file-history", SESSION_A), { recursive: true });
    writeFileSync(join(tree.treeRoot, "file-history", SESSION_A, "abc@v1"), "history bytes\n");
    return { treeRoot: tree.treeRoot, session: new Path(join(tree.projectDir, "a.jsonl")) };
}

function writeSession(records: object[]): Path {
    return writeSessionTree(records).session;
}

function listSources(candidates: BeaconCandidate[]): BeaconSource[] {
    return candidates.map((candidate) => candidate.source);
}

test("test_beacon_source_names_map_the_users_five_names_to_four_sources", () => {
    // backup and snapshot are one reader (file history); read echo, Bash(cat) and commit keep their own.
    assert.deepEqual(Object.values(BeaconSource), ["fileHistory", "readEcho", "bashCat", "commit"]);
});

test("test_read_echo_alone_gives_one_read_echo_candidate", () => {
    const target = "/work/notes.txt";
    const session = writeSession(buildReadRecordPair(buildEnvelope("/work", "toolu_r1", 1), target, "read bytes\n", COMPLETE_WINDOW).records);
    const candidates = listBeaconCandidates(new Path(target), [session], new Path(makeEmptyFolder()), undefined);
    assert.deepEqual(listSources(candidates), [BeaconSource.readEcho]);
    assert.equal(candidates[0]!.content, "read bytes\n");
});

test("test_partial_read_gives_no_candidate", () => {
    const target = "/work/notes.txt";
    const partial = { startLine: 1, numLines: 1, totalLines: 3 };
    const session = writeSession(buildReadRecordPair(buildEnvelope("/work", "toolu_r1", 1), target, "read bytes\n", partial).records);
    assert.deepEqual(listBeaconCandidates(new Path(target), [session], new Path(makeEmptyFolder()), undefined), []);
});

test("test_bash_cat_alone_gives_one_bash_cat_candidate", () => {
    const session = writeSession(buildCatRecords("/work", "toolu_c1", 2, "cat bytes\n"));
    const candidates = listBeaconCandidates(new Path("/work/notes.txt"), [session], new Path(makeEmptyFolder()), undefined);
    assert.deepEqual(listSources(candidates), [BeaconSource.bashCat]);
    assert.equal(candidates[0]!.content, "cat bytes\n");
});

test("test_file_history_alone_gives_one_file_history_candidate", () => {
    const cwdRecords = buildCatRecords("/work", "toolu_x", 0, "");
    const session = writeSession([cwdRecords[0]!, buildSnapshotRecord("2026-07-24T10:03:00.000Z")]);
    const candidates = listBeaconCandidates(new Path("/work/notes.txt"), [session], new Path(makeEmptyFolder()), undefined);
    assert.deepEqual(listSources(candidates), [BeaconSource.fileHistory]);
    assert.equal(candidates[0]!.content, "history bytes\n");
});

test("test_declared_sources_choose_the_file_history_folder", () => {
    const cwdRecords = buildCatRecords("/work", "toolu_x", 0, "");
    const { treeRoot, session } = writeSessionTree([cwdRecords[0]!, buildSnapshotRecord("2026-07-24T10:03:00.000Z")]);
    const declaredHistory = mkdtempSync(join(tmpdir(), "beacon-candidates-declared-"));
    mkdirSync(join(declaredHistory, SESSION_A), { recursive: true });
    writeFileSync(join(declaredHistory, SESSION_A, "abc@v1"), "declared bytes\n");
    const sources = [{ projectsDir: new Path(join(treeRoot, "projects")), fileHistoryDir: new Path(declaredHistory) }];
    const candidates = listBeaconCandidates(new Path("/work/notes.txt"), [session], new Path(makeEmptyFolder()), sources);
    assert.deepEqual(listSources(candidates), [BeaconSource.fileHistory]);
    assert.equal(candidates[0]!.content, "declared bytes\n");
});

test("test_commit_alone_gives_one_commit_candidate", () => {
    const repoDir = makeRepoWithOneCommit();
    const candidates = listBeaconCandidates(new Path(join(repoDir, "notes.txt")), [], new Path(repoDir), undefined);
    assert.deepEqual(listSources(candidates), [BeaconSource.commit]);
    assert.equal(candidates[0]!.content, "commit bytes\n");
});

test("test_crafted_session_holds_all_four_sources_sorted_by_instant", () => {
    const repoDir = makeRepoWithOneCommit();
    const target = join(repoDir, "notes.txt");
    const read = buildReadRecordPair(buildEnvelope(repoDir, "toolu_r1", 1), target, "read bytes\n", COMPLETE_WINDOW);
    const session = writeSession([...read.records, ...buildCatRecords(repoDir, "toolu_c1", 2, "cat bytes\n"), buildSnapshotRecord("2026-07-24T10:03:00.000Z")]);
    const candidates = listBeaconCandidates(new Path(target), [session], new Path(repoDir), undefined);
    assert.deepEqual(listSources(candidates), [BeaconSource.commit, BeaconSource.readEcho, BeaconSource.bashCat, BeaconSource.fileHistory]);
});
