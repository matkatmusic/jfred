// The /api/layer1-inverse-repos wire: one InverseCommit maps to strings, and the result has one entry per project file.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateConfidence, StateMoment } from "../engineV3/engineV3_file_known_states.ts";
import type { InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildInverseCommitWire, buildInverseReposWire } from "../src/layer1_inverse_repos_wire.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { SESSION_A, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

const COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";
const TREE_HASH = "89abcdef0123456789abcdef0123456789abcdef";

function buildInverseCommit(instant: Date | undefined, eventType: FileEventType = FileEventType.WriteRow): InverseCommit {
    return {
        commitHash: new Uuid(COMMIT_HASH),
        treeHash: new Uuid(TREE_HASH),
        position: 3,
        eventType,
        moment: StateMoment.BeforeEvent,
        confidence: StateConfidence.Proven,
        instant,
        jsonlPath: undefined,
        line: undefined,
        isFileAbsent: false,
        removedByScript: false,
        movedAwayToFile: undefined,
        text: "file text that must not reach the wire\n",
    };
}

// The layered search needs a repo with a HEAD commit.
function initGitRepo(folder: string): void {
    execFileSync("git", ["init", "-q"], { cwd: folder });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: folder });
}

// A project folder holding a.py and sub/b.py, plus a log folder whose Write rows name both.
function writeProjectWithLogs(): { projectFolder: Path; jsonlFolder: Path; snapshotsFolder: Path; storeFolder: Path } {
    const projectFolder = createTempDir();
    initGitRepo(projectFolder);
    mkdirSync(join(projectFolder, "sub"));
    writeFileSync(join(projectFolder, "a.py"), "one\n");
    writeFileSync(join(projectFolder, "sub", "b.py"), "two\n");
    const tree = createSourceTree("-inverse-repos-wire");
    const envelopeA = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
    const envelopeB = { ...envelopeA, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
    const writeA = buildWriteRecordPair(envelopeA, join(projectFolder, "a.py"), "one\n");
    const writeB = buildWriteRecordPair(envelopeB, join(projectFolder, "sub", "b.py"), "two\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeA.records, ...writeB.records]);
    const storeFolder = mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-"));
    return { projectFolder: new Path(projectFolder), jsonlFolder: new Path(tree.projectDir), snapshotsFolder: new Path(join(tree.treeRoot, "file-history")), storeFolder: new Path(join(storeFolder, "store")) };
}

test("test_inverse_commit_wire_maps_instant_to_iso_string", () => {
    const wire = buildInverseCommitWire(buildInverseCommit(new Date("2026-07-24T10:01:00.000Z")));
    assert.deepEqual(wire, {
        commitHash: COMMIT_HASH,
        treeHash: TREE_HASH,
        eventType: "WriteRow",
        moment: "before-event",
        confidence: "proven",
        position: 3,
        instant: "2026-07-24T10:01:00.000Z",
        readerInstant: "2026-07-24T10:01:00.000Z",
        isFileAbsent: false,
        isRemoved: false,
        movedAwayTo: null,
    });
});

test("test_inverse_commit_wire_sends_the_tree_hash_as_text", () => {
    // Scenario: a commit with a known tree hash.
    const wire = buildInverseCommitWire(buildInverseCommit(undefined));
    // The wire holds the tree hash as text.
    assert.equal(wire.treeHash, TREE_HASH);
});

test("test_inverse_commit_wire_maps_undefined_instant_to_null", () => {
    const wire = buildInverseCommitWire(buildInverseCommit(undefined));
    assert.equal(wire.instant, null);
});

test("test_inverse_commit_wire_maps_the_instant_of_a_disk_now_commit_to_null", () => {
    // Scenario: the disk-now commit holds the modified time of the file as its instant.
    const wire = buildInverseCommitWire(buildInverseCommit(new Date("2026-07-24T10:01:00.000Z"), FileEventType.DiskNow));
    // The wire still sends null, so the page reads row 0.
    assert.equal(wire.instant, null);
});

test("test_the_disk_now_commit_of_a_file_on_disk_sends_its_mtime_as_reader_instant", () => {
    // Scenario: the disk-now commit of a file on disk holds the file mtime as its instant.
    const wire = buildInverseCommitWire(buildInverseCommit(new Date("2026-07-24T10:01:00.000Z"), FileEventType.DiskNow));
    // The reader instant is that mtime, while the instant stays null.
    assert.equal(wire.readerInstant, "2026-07-24T10:01:00.000Z");
    assert.equal(wire.instant, null);
});

test("test_the_disk_now_commit_of_a_gone_file_sends_a_null_reader_instant", () => {
    // Scenario: the disk-now commit of a file that is gone has no mtime.
    const wire = buildInverseCommitWire(buildInverseCommit(undefined, FileEventType.DiskNow));
    // The reader instant is null.
    assert.equal(wire.readerInstant, null);
});

test("test_another_commit_sends_its_instant_as_reader_instant", () => {
    // Scenario: a write commit with an instant.
    const wire = buildInverseCommitWire(buildInverseCommit(new Date("2026-07-24T10:01:00.000Z")));
    // The reader instant equals the instant.
    assert.equal(wire.readerInstant, wire.instant);
    assert.equal(wire.readerInstant, "2026-07-24T10:01:00.000Z");
});

test("test_inverse_commit_wire_maps_removed_by_script_to_is_removed", () => {
    // Scenario: a commit flagged removed by a script.
    const commit = { ...buildInverseCommit(undefined), removedByScript: true };
    // The wire says the commit is removed.
    assert.equal(buildInverseCommitWire(commit).isRemoved, true);
});

test("test_inverse_commit_wire_maps_the_moved_away_destination_to_moved_away_to", () => {
    // Scenario: a commit flagged as moved away to an absolute destination.
    const commit = { ...buildInverseCommit(undefined), movedAwayToFile: new Path("/project/moved/b.py") };
    // The wire holds the destination text unchanged.
    assert.equal(buildInverseCommitWire(commit).movedAwayTo, "/project/moved/b.py");
});

test("test_inverse_commit_wire_maps_no_destination_to_null", () => {
    // Scenario: a commit with no moved-away destination.
    const wire = buildInverseCommitWire(buildInverseCommit(undefined));
    // The wire holds null and the commit is not removed.
    assert.equal(wire.movedAwayTo, null);
    assert.equal(wire.isRemoved, false);
});

test("test_inverse_repos_wire_of_a_project_with_an_rm_run_has_a_commit_with_is_removed_true", () => {
    // Scenario: the log writes a.py and then runs `rm` on it; a.py is not on disk.
    const projectFolder = createTempDir();
    initGitRepo(projectFolder);
    const filePath = join(projectFolder, "a.py");
    const tree = createSourceTree("-inverse-repos-wire-rm");
    const envelope = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
    const writeRecords = buildWriteRecordPair(envelope, filePath, "one\n").records;
    const rmRecord = {
        type: "assistant",
        uuid: "toolu_rm1-assistant",
        sessionId: SESSION_A,
        timestamp: "2026-07-24T10:03:00.000Z",
        cwd: projectFolder,
        message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_rm1", name: "Bash", input: { command: `rm ${filePath}` }, caller: { type: "direct" } }] },
    };
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeRecords, rmRecord]);
    const storeFolder = new Path(join(mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-")), "store"));
    // The wire is built.
    const wire = buildInverseReposWire(new Path(projectFolder), [new Path(tree.projectDir)], [new Path(join(tree.treeRoot, "file-history"))], storeFolder);
    rmSync(storeFolder.toString(), { recursive: true, force: true });
    // a.py has a commit with isRemoved true, and that commit also has isFileAbsent true.
    const commits = wire.files.find((fileWire) => fileWire.file === "a.py")!.commits;
    const removedCommit = commits.find((commit) => commit.isRemoved)!;
    assert.equal(removedCommit.isFileAbsent, true);
});

test("test_inverse_repos_wire_has_one_entry_per_file", () => {
    const { projectFolder, jsonlFolder, snapshotsFolder, storeFolder } = writeProjectWithLogs();
    const wire = buildInverseReposWire(projectFolder, [jsonlFolder], [snapshotsFolder], storeFolder);
    rmSync(storeFolder.toString(), { recursive: true, force: true });
    assert.deepEqual(wire.files.map((fileWire) => fileWire.file), ["a.py", "sub/b.py"]);
    assert.equal(wire.files[0]!.commits[0]!.eventType, "DiskNow");
});

// Obsolete: the user ruled that a session scratchpad file gets its own entry (see the next test).
// test("test_inverse_repos_wire_drops_a_file_outside_the_project_folder", () => {
//     // Scenario: the log writes a.py inside the project and a session scratchpad file outside the project.
//     const projectFolder = createTempDir();
//     initGitRepo(projectFolder);
//     writeFileSync(join(projectFolder, "a.py"), "one\n");
//     const scratchpadFile = join("/private/tmp/claude-501", "reveng-test", SESSION_A, "scratchpad", "nodecheck", "a.js");
//     const tree = createSourceTree("-inverse-repos-wire-outside");
//     const envelopeInside = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
//     const envelopeOutside = { ...envelopeInside, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
//     const writeInside = buildWriteRecordPair(envelopeInside, join(projectFolder, "a.py"), "one\n");
//     const writeOutside = buildWriteRecordPair(envelopeOutside, scratchpadFile, "two\n");
//     writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeInside.records, ...writeOutside.records]);
//     const storeFolder = new Path(join(mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-")), "store"));
//     // The wire is built, and the build does not throw.
//     const wire = buildInverseReposWire(new Path(projectFolder), [new Path(tree.projectDir)], [new Path(join(tree.treeRoot, "file-history"))], storeFolder);
//     rmSync(storeFolder.toString(), { recursive: true, force: true });
//     // The wire holds only a.py: the scratchpad file is dropped.
//     assert.deepEqual(wire.files.map((fileWire) => fileWire.file), ["a.py"]);
// });

// Obsolete: the user ruled that the layered search list is definitive and nothing is dropped (see the last test).
// test("test_inverse_repos_wire_has_an_entry_for_a_session_scratchpad_file", () => {
//     // Scenario: the log writes a.py inside the project and a session scratchpad file outside the project.
//     const projectFolder = createTempDir();
//     initGitRepo(projectFolder);
//     writeFileSync(join(projectFolder, "a.py"), "one\n");
//     const scratchpadFile = join("/private/tmp/claude-501", "reveng-test", SESSION_A, "scratchpad", "nodecheck", "a.js");
//     const tree = createSourceTree("-inverse-repos-wire-scratchpad");
//     const envelopeInside = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
//     const envelopeOutside = { ...envelopeInside, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
//     const writeInside = buildWriteRecordPair(envelopeInside, join(projectFolder, "a.py"), "one\n");
//     const writeOutside = buildWriteRecordPair(envelopeOutside, scratchpadFile, "two\n");
//     writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeInside.records, ...writeOutside.records]);
//     const storeFolder = new Path(join(mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-")), "store"));
//     // The wire is built, and the build does not throw.
//     const wire = buildInverseReposWire(new Path(projectFolder), [new Path(tree.projectDir)], [new Path(join(tree.treeRoot, "file-history"))], storeFolder);
//     rmSync(storeFolder.toString(), { recursive: true, force: true });
//     // The wire holds a.py and the scratchpad file, named ".scratchpad/" plus the absolute path without its leading slash.
//     const scratchpadEntryName = ".scratchpad/private/tmp/claude-501/reveng-test/" + SESSION_A + "/scratchpad/nodecheck/a.js";
//     assert.deepEqual(wire.files.map((fileWire) => fileWire.file).sort(), ["a.py", scratchpadEntryName].sort());
// });

// Obsolete: the user ruled that nothing is dropped, so a worktree file outside the project keeps an entry.
// test("test_inverse_repos_wire_drops_a_file_outside_the_project_folder_that_is_not_a_scratchpad", () => {
//     // Scenario: the project has an unmerged worktree in a folder outside the project; the log writes a.py inside the project and a file inside that worktree.
//     const projectFolder = createTempDir();
//     initGitRepo(projectFolder);
//     writeFileSync(join(projectFolder, "a.py"), "one\n");
//     const worktreeFolder = join(mkdtempSync(join(tmpdir(), "inverse-repos-wire-worktree-")), "other");
//     execFileSync("git", ["worktree", "add", "-q", worktreeFolder, "-b", "other-branch"], { cwd: projectFolder });
//     execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "unmerged"], { cwd: worktreeFolder });
//     const tree = createSourceTree("-inverse-repos-wire-worktree");
//     const envelopeInside = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
//     const envelopeOutside = { ...envelopeInside, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
//     const writeInside = buildWriteRecordPair(envelopeInside, join(projectFolder, "a.py"), "one\n");
//     const writeOutside = buildWriteRecordPair(envelopeOutside, join(worktreeFolder, "w.py"), "two\n");
//     writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeInside.records, ...writeOutside.records]);
//     const storeFolder = new Path(join(mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-")), "store"));
//     // The wire is built, and the build does not throw.
//     const wire = buildInverseReposWire(new Path(projectFolder), [new Path(tree.projectDir)], [new Path(join(tree.treeRoot, "file-history"))], storeFolder);
//     rmSync(storeFolder.toString(), { recursive: true, force: true });
//     rmSync(join(worktreeFolder, ".."), { recursive: true, force: true });
//     // The wire holds only a.py: the worktree file is dropped.
//     assert.deepEqual(wire.files.map((fileWire) => fileWire.file), ["a.py"]);
// });

test("test_inverse_repos_wire_has_an_entry_for_a_file_outside_the_project_folder", () => {
    // Scenario: the log writes a.py inside the project and a file outside the project.
    const projectFolder = createTempDir();
    initGitRepo(projectFolder);
    writeFileSync(join(projectFolder, "a.py"), "one\n");
    const outsideFile = join("/private/tmp/claude-501", "reveng-test", SESSION_A, "scratchpad", "nodecheck", "a.js");
    const tree = createSourceTree("-inverse-repos-wire-outside");
    const envelopeInside = { sessionId: SESSION_A, cwd: projectFolder, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_w1", parentUuid: null };
    const envelopeOutside = { ...envelopeInside, timestamp: "2026-07-24T10:02:00.000Z", toolId: "toolu_w2" };
    const writeInside = buildWriteRecordPair(envelopeInside, join(projectFolder, "a.py"), "one\n");
    const writeOutside = buildWriteRecordPair(envelopeOutside, outsideFile, "two\n");
    writeTranscriptFixture(tree.projectDir, "a.jsonl", [...writeInside.records, ...writeOutside.records]);
    const storeFolder = new Path(join(mkdtempSync(join(tmpdir(), "inverse-repos-wire-store-")), "store"));
    // The wire is built, and the build does not throw.
    const wire = buildInverseReposWire(new Path(projectFolder), [new Path(tree.projectDir)], [new Path(join(tree.treeRoot, "file-history"))], storeFolder);
    rmSync(storeFolder.toString(), { recursive: true, force: true });
    // The wire holds a.py and the outside file, named ".outside-project/" plus the absolute path without its leading slash.
    const outsideEntryName = ".outside-project/private/tmp/claude-501/reveng-test/" + SESSION_A + "/scratchpad/nodecheck/a.js";
    assert.deepEqual(wire.files.map((fileWire) => fileWire.file).sort(), ["a.py", outsideEntryName].sort());
});
