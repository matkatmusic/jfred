// The TUI bar of a file holds only the git beacons (and the on-disk commit 0), although the logs hold edit rows for the file.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildOnDemandInverseReposForFiles } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { listInverseRepoFileWire } from "../engineV3/tui/engineV3_tui_bars.ts";
import { PROJECT_FILE_NAME, commitFileAtSecond, makeEditRows, writeProject } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

test("test_tui_bar_holds_only_the_git_beacons_of_the_file_newest_first", (t) => {
    // Scenario: a file has two git commits (second 5 "one", second 15 "two") and two Edit rows in the log (one to two at second 10, two to three at second 20); the disk text is "three".
    // Steps:
    const project = writeProject(t, "three\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
    commitFileAtSecond(project.projectFolder.toString(), PROJECT_FILE_NAME, "one\n", 5);
    commitFileAtSecond(project.projectFolder.toString(), PROJECT_FILE_NAME, "two\n", 15);
    writeFileSync(join(project.projectFolder.toString(), PROJECT_FILE_NAME), "three\n");
    // the store of the file is built with the git repo folder.
    buildOnDemandInverseReposForFiles(project.projectFolder, [{ file: project.file, transcriptFile: project.file }], [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {}, undefined, project.projectFolder);
    // the bar is the on-disk commit 0, then the two git commits newest first; no Edit event is in it.
    const commits = listInverseRepoFileWire(project.storeFolder, project.projectFolder, project.file).commits;
    assert.deepEqual(commits.map((commit) => commit.eventType), [FileEventType.DiskNow, FileEventType.GitCommit, FileEventType.GitCommit]);
    assert.deepEqual(commits.map((commit) => commit.position), [0, 1, 2]);
});
