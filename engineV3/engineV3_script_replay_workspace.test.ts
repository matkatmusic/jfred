import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile } from "./engineV3_inverse_repos_for_project.ts";
import { FileEventType } from "./engineV3_replay_reverse_events.ts";
import { ScriptReplayInputKind } from "./engineV3_script_replay_container.ts";
import { ReplayWorkspace } from "./engineV3_script_replay_workspace.ts";

const FILE_NAME = "a.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

type WorkspaceSetup = { storeFolder: Path; projectFolder: Path; file: Path; repoFolder: Path; workspace: ReplayWorkspace };

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeOrderedState(position: number, second: number | undefined, text: string | undefined): OrderedKnownState {
    let eventType = FileEventType.GitCommit;
    let instant: Date | undefined;
    if (second === undefined) {
        eventType = FileEventType.DiskNow;
    } else {
        instant = makeInstant(second);
    }
    const event = { type: eventType, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
    const state: FileKnownState = { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, isFileAbsent: text === undefined, text };
    return { state, position };
}

// Position 0 is the disk-now state; a larger position is older.
function makeWorkspace(t: TestContext, olderStates: OrderedKnownState[]): WorkspaceSetup {
    const rootFolder = mkdtempSync(join(tmpdir(), "engine-v3-replay-workspace-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const storeFolder = new Path(join(rootFolder, "store"));
    const projectFolder = new Path(join(rootFolder, "project"));
    mkdirSync(storeFolder.toString());
    mkdirSync(projectFolder.toString());
    const file = new Path(join(projectFolder.toString(), FILE_NAME));
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
    createInverseRepo(repoFolder, FILE_NAME, makeOrderedState(0, undefined, "now\n"), DISK_NOW_INSTANT);
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, olderStates);
    const workspace = new ReplayWorkspace(storeFolder, projectFolder, projectFolder, [{ file, transcriptFile: file }]);
    return { storeFolder, projectFolder, file, repoFolder, workspace };
}

test("test_input_uses_the_repo_commit_just_before_the_instant", (t) => {
    // Scenario: a script at second 250 gets the text the repo holds at second 249.999.
    // The repo holds "one" at second 100, "two" at second 200 and "three" at second 300.
    const { workspace, repoFolder } = makeWorkspace(t, [makeOrderedState(1, 300, "three\n"), makeOrderedState(2, 200, "two\n"), makeOrderedState(3, 100, "one\n")]);
    // The inputs are listed just before second 250.
    const inputs = workspace.listInputFilesJustBefore(makeInstant(250));
    // One input is listed, at the relative path "a.txt", read from the store at the commit of "two".
    const twoCommit = listInverseCommits(repoFolder, FILE_NAME).find((commit) => commit.text === "two\n")!;
    assert.deepEqual(inputs, [{ relativePath: "a.txt", source: { kind: ScriptReplayInputKind.Store, repoRelativePath: "a.txt.git", commitHash: twoCommit.commitHash.toString() } }]);
});

test("test_input_uses_the_in_pass_text_when_it_is_newer_than_the_repo_commit", (t) => {
    // Scenario: an earlier step of this pass changed the file after the newest repo commit before the instant.
    // The repo holds "one" at second 100 and "two" at second 200.
    const { workspace, file } = makeWorkspace(t, [makeOrderedState(1, 200, "two\n"), makeOrderedState(2, 100, "one\n")]);
    // An earlier step recorded "in-pass" at second 220.
    workspace.recordTextAfterStep(file, makeInstant(220), "in-pass\n");
    // The inputs are listed just before second 250.
    const inputs = workspace.listInputFilesJustBefore(makeInstant(250));
    // The input is a text source holding "in-pass".
    assert.deepEqual(inputs, [{ relativePath: "a.txt", source: { kind: ScriptReplayInputKind.Text, text: "in-pass\n" } }]);
});

test("test_input_uses_the_repo_commit_when_it_is_newer_than_the_in_pass_text", (t) => {
    // Scenario: the repo commit at second 200 is newer than the in-pass text at second 150.
    const { workspace, file, repoFolder } = makeWorkspace(t, [makeOrderedState(1, 200, "two\n"), makeOrderedState(2, 100, "one\n")]);
    // An earlier step recorded "in-pass" at second 150.
    workspace.recordTextAfterStep(file, makeInstant(150), "in-pass\n");
    // The inputs are listed just before second 250.
    const inputs = workspace.listInputFilesJustBefore(makeInstant(250));
    // The input is a store source at the commit of "two".
    const twoCommit = listInverseCommits(repoFolder, FILE_NAME).find((commit) => commit.text === "two\n")!;
    assert.deepEqual(inputs, [{ relativePath: "a.txt", source: { kind: ScriptReplayInputKind.Store, repoRelativePath: "a.txt.git", commitHash: twoCommit.commitHash.toString() } }]);
});

test("test_absent_file_is_left_out_of_the_inputs", (t) => {
    // Scenario: the chosen state of the file is absent.
    // The repo holds "one" at second 100 and an absent state at second 200.
    const { workspace, file } = makeWorkspace(t, [makeOrderedState(1, 200, undefined), makeOrderedState(2, 100, "one\n")]);
    // The inputs are listed just before second 250.
    const inputs = workspace.listInputFilesJustBefore(makeInstant(250));
    // No input is listed.
    assert.deepEqual(inputs, []);
    // The text of the file just before second 250 is undefined.
    assert.equal(workspace.getTextJustBefore(file, makeInstant(250)), undefined);
});

test("test_file_without_a_commit_before_the_instant_is_left_out", (t) => {
    // Scenario: every commit of the file is newer than the instant.
    // The repo holds "one" at second 100.
    const { workspace, file } = makeWorkspace(t, [makeOrderedState(1, 100, "one\n")]);
    // The inputs are listed just before second 50.
    const inputs = workspace.listInputFilesJustBefore(makeInstant(50));
    // No input is listed.
    assert.deepEqual(inputs, []);
    // The text of the file just before second 50 is undefined.
    assert.equal(workspace.getTextJustBefore(file, makeInstant(50)), undefined);
});

test("test_clear_in_pass_texts_returns_to_the_repo_commit", (t) => {
    // Scenario: after the in-pass texts of a file are cleared, the repo commit is used again.
    // The repo holds "two" at second 200.
    const { workspace, file } = makeWorkspace(t, [makeOrderedState(1, 200, "two\n")]);
    // An earlier step recorded "in-pass" at second 220.
    workspace.recordTextAfterStep(file, makeInstant(220), "in-pass\n");
    // The text just before second 250 is "in-pass".
    assert.equal(workspace.getTextJustBefore(file, makeInstant(250)), "in-pass\n");
    // The in-pass texts of the file are cleared.
    workspace.clearInPassTexts(file);
    // The text just before second 250 is "two".
    assert.equal(workspace.getTextJustBefore(file, makeInstant(250)), "two\n");
});

test("test_refresh_repo_shows_a_commit_added_after_the_first_read", (t) => {
    // Scenario: the commit list of a repo is cached until refreshRepo is called.
    // The repo holds "one" at second 100.
    const { workspace, file, repoFolder } = makeWorkspace(t, [makeOrderedState(2, 100, "one\n")]);
    // The text just before second 250 is "one", which fills the cache.
    assert.equal(workspace.getTextJustBefore(file, makeInstant(250)), "one\n");
    // A commit holding "two" at second 200 is added to the repo.
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [makeOrderedState(1, 200, "two\n")]);
    // Before the refresh the text is still "one".
    assert.equal(workspace.getTextJustBefore(file, makeInstant(250)), "one\n");
    // After the refresh the text is "two".
    workspace.refreshRepo(file);
    assert.equal(workspace.getTextJustBefore(file, makeInstant(250)), "two\n");
});
