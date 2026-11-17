import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import type { InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { StateConfidence, StateMoment } from "../engineV3/engineV3_file_known_states.ts";
import { getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { ScriptReplayInputKind } from "../engineV3/engineV3_script_replay_container.ts";
import { ReplayWorkspace } from "../engineV3/engineV3_script_replay_workspace.ts";

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeCommit(position: number, eventType: FileEventType, instant: Date, hash: string, text: string): InverseCommit {
    return { commitHash: new Uuid(hash), treeHash: new Uuid(`tree-${hash}`), position, eventType, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, instant, jsonlPath: undefined, line: undefined, isFileAbsent: false, removedByScript: false, movedAwayToFile: undefined, text };
}

test("test_listInputFilesJustBefore_uses_the_commits_set_for_a_file_and_needs_no_repo_folder", () => {
    // Scenario: commits set on the workspace stand in for a repo folder that does not exist.
    const storeFolder = new Path(join("/nonexistent-store-for-test", "store"));
    const projectFolder = new Path(join("/nonexistent-store-for-test", "project"));
    const file = new Path(join(projectFolder.toString(), "a.txt"));
    const workspace = new ReplayWorkspace(storeFolder, projectFolder, projectFolder, [{ file, transcriptFile: file }]);
    // The commits are newest first: DiskNow at second 100 with text "x", an At-event at second 30 with text "y".
    const diskNowCommit = makeCommit(0, FileEventType.DiskNow, makeInstant(100), "hash-disk-now", "x");
    const atEventCommit = makeCommit(1, FileEventType.GitCommit, makeInstant(30), "hash-at-event", "y");
    workspace.setCommits(file, [diskNowCommit, atEventCommit]);
    // The inputs are listed just before second 50.
    const inputs = workspace.listInputFilesJustBefore(makeInstant(50));
    // One input is listed, read from the store at the commit of second 30.
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
    const repoRelativePath = repoFolder.toString().slice(storeFolder.toString().length + 1);
    assert.deepEqual(inputs, [{ relativePath: "a.txt", source: { kind: ScriptReplayInputKind.Store, repoRelativePath, commitHash: "hash-at-event" } }]);
});
