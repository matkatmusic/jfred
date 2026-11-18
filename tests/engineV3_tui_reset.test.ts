// Tests of the reset loop of the terminal viewer: check first, wait for the child, remove only repos inside the store.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { STAMP_FILE_NAME } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import { resetAllStores, resetStoresOfFiles, type FileStore } from "../engineV3/tui/engineV3_tui_reset.ts";
import type { FileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";

const CANCEL_DELAY_MILLISECONDS = 60;
const HALF_CANCEL_DELAY_MILLISECONDS = 20;

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeTemporaryFolder(testContext: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "jfred-tui-reset-"));
    testContext.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeStampedRepoFolder(parentFolder: string, relativeRepoPath: string): string {
    const repoFolder = join(parentFolder, relativeRepoPath);
    mkdirSync(repoFolder, { recursive: true });
    writeFileSync(join(repoFolder, STAMP_FILE_NAME), "{}");
    writeFileSync(join(repoFolder, "HEAD"), "ref: refs/heads/main");
    return repoFolder;
}

test("test_resetAllStores_checks_the_whole_store_before_removing_anything", async (testContext) => {
    // Scenario: one repo folder without a stamp sits among good repos: the call throws and every good repo stays.
    // a store holds two good repos and one repo folder that has no stamp file.
    const storeFolder = makeTemporaryFolder(testContext);
    const firstGoodRepo = makeStampedRepoFolder(storeFolder, "a/first.ts.git");
    const secondGoodRepo = makeStampedRepoFolder(storeFolder, "z/deep/second.ts.git");
    const badRepo = join(storeFolder, "m/bad.ts.git");
    mkdirSync(badRepo, { recursive: true });
    writeFileSync(join(badRepo, "HEAD"), "ref: refs/heads/main");
    // the reset of all stores is asked for.
    const reset = resetAllStores(new Path(storeFolder), async () => {}, () => {});
    // the call throws.
    await assert.rejects(reset);
    // both good repos and the bad folder are still there.
    assert.equal(existsSync(firstGoodRepo), true);
    assert.equal(existsSync(secondGoodRepo), true);
    assert.equal(existsSync(badRepo), true);
});

test("test_resetAllStores_removes_every_repo_in_the_store_including_files_the_tui_does_not_list", async (testContext) => {
    // Scenario: a play wrote a repo for a file that the layered list does not hold: the reset of all stores removes it too.
    // a store holds repos at two depths. The call gets no file list at all.
    const storeFolder = makeTemporaryFolder(testContext);
    const topRepo = makeStampedRepoFolder(storeFolder, "listed.ts.git");
    const deepRepo = makeStampedRepoFolder(storeFolder, "not/listed/by/the/tui.ts.git");
    const events: string[] = [];
    // the reset of all stores is asked for.
    await resetAllStores(
        new Path(storeFolder),
        async () => {
            events.push("cancelAll");
        },
        () => {
            events.push("clearAllFileStates");
        },
    );
    // every repo is gone.
    assert.equal(existsSync(topRepo), false);
    assert.equal(existsSync(deepRepo), false);
    // every child was cancelled first, and the file states were cleared.
    assert.deepEqual(events, ["cancelAll", "clearAllFileStates"]);
});

test("test_resetStoresOfFiles_waits_for_the_child_to_exit_before_removing", async (testContext) => {
    // Scenario: the child of a file is still running: the repo folder stays until the child has exited.
    // a store holds the repo of one file.
    const storeFolder = makeTemporaryFolder(testContext);
    const repoFolder = makeStampedRepoFolder(storeFolder, "src/file.ts.git");
    const file = new Path("/project/src/file.ts");
    const fileStores: FileStore[] = [{ file, repoFolder: new Path(repoFolder) }];
    const events: string[] = [];
    // cancelling the file takes a while: it resolves after a timer, and notes whether the folder still exists at that moment.
    const cancelFile = async (cancelledFile: Path): Promise<void> => {
        assert.equal(cancelledFile.equals(file), true);
        await waitMilliseconds(CANCEL_DELAY_MILLISECONDS);
        events.push(existsSync(repoFolder) ? "cancel resolved, folder still there" : "cancel resolved, folder already removed");
    };
    const clearFileState = (): void => {
        events.push(existsSync(repoFolder) ? "state cleared, folder still there" : "state cleared, folder removed");
    };
    // the reset starts and half of the cancel delay passes.
    const reset = resetStoresOfFiles(new Path(storeFolder), fileStores, cancelFile, clearFileState);
    await waitMilliseconds(HALF_CANCEL_DELAY_MILLISECONDS);
    // the child has not exited yet, so the folder is still there.
    assert.equal(existsSync(repoFolder), true);
    await reset;
    // the order was: the cancel resolved with the folder in place, then the folder was removed, then the state was cleared.
    assert.deepEqual(events, ["cancel resolved, folder still there", "state cleared, folder removed"]);
    assert.equal(existsSync(repoFolder), false);
});

test("test_reset_throws_on_a_repo_folder_reached_through_a_linked_parent_and_removes_nothing", async (testContext) => {
    // Scenario: a symbolic link inside the store points outside it: a repo reached through that link is not removed.
    // a folder outside the store holds a stamped repo.
    const outsideFolder = makeTemporaryFolder(testContext);
    const outsideRepo = makeStampedRepoFolder(outsideFolder, "outside.ts.git");
    // the store holds a symbolic link folder that points to the outside folder.
    const storeFolder = makeTemporaryFolder(testContext);
    symlinkSync(outsideFolder, join(storeFolder, "linked"));
    const repoFolderThroughLink = join(storeFolder, "linked", "outside.ts.git");
    const file = new Path("/project/outside.ts");
    const clearedFiles: Path[] = [];
    // the reset of that file is asked for.
    const reset = resetStoresOfFiles(
        new Path(storeFolder),
        [{ file, repoFolder: new Path(repoFolderThroughLink) }],
        async () => {},
        (clearedFile) => {
            clearedFiles.push(clearedFile);
        },
    );
    // the call throws.
    await assert.rejects(reset);
    // the repo outside the store still exists with its stamp, and no file state was cleared.
    assert.equal(existsSync(outsideRepo), true);
    assert.equal(existsSync(join(outsideRepo, STAMP_FILE_NAME)), true);
    assert.deepEqual(clearedFiles, []);
});

test("test_reset_of_a_running_file_shows_idle_not_crashed", async (testContext) => {
    // Scenario: the step child of a file is running and gets ended by the reset: the pool shows Idle for that file and reports no outcome.
    // a store holds the repo of one file.
    const storeFolder = makeTemporaryFolder(testContext);
    const repoFolder = makeStampedRepoFolder(storeFolder, "src/file.ts.git");
    const file = new Path("/project/src/file.ts");
    const fileStores: FileStore[] = [{ file, repoFolder: new Path(repoFolder) }];
    // the fake step child never answers until the fake end of the child resolves it with a Crashed outcome.
    const resolveOutcomeByFileValue = new Map<string, (outcome: StepProcessOutcome) => void>();
    const announcedRunStates: FileRunState[] = [];
    const reportedOutcomes: StepProcessOutcome[] = [];
    const pool = createStepPool({
        maxProcesses: 1,
        spawnStepProcess: (request) => new Promise<StepProcessOutcome>((resolve) => {
            resolveOutcomeByFileValue.set(request.file.value, resolve);
        }),
        spawnPlayProcess: async () => {
            throw new Error("no play is expected in this test");
        },
        onOutcome: (_request: StepRequest, outcome: StepProcessOutcome) => {
            reportedOutcomes.push(outcome);
        },
        onStatusChange: (statusFile, runState) => {
            if (statusFile.equals(file)) {
                announcedRunStates.push(runState);
            }
        },
        isFileWalkFinished: () => false,
        isFileSteppable: () => true,
        hasLogsGrown: () => false,
        onLogsGrew: () => {},
        endChildOfFile: async (endedFile) => {
            const resolveOutcome = resolveOutcomeByFileValue.get(endedFile.value);
            assert.notEqual(resolveOutcome, undefined);
            resolveOutcome!({ kind: StepProcessOutcomeKind.Crashed, exitCode: null, signal: "SIGTERM", crashedAt: null, stderrTail: "" });
        },
        endAllChildren: async () => {},
    });
    // a walk is requested for the file, so the file is Running.
    pool.requestWalk({ file, startAt: new Date(1000), isPassingStops: false }, true);
    assert.equal(announcedRunStates[announcedRunStates.length - 1]!.status, FileWalkStatus.Running);
    // the reset of that file is asked for, using the pool's cancel.
    await resetStoresOfFiles(new Path(storeFolder), fileStores, pool.cancelFile, () => {});
    // the repo folder is removed.
    assert.equal(existsSync(repoFolder), false);
    // the last status the pool announced for the file is Idle, and no announced status was Crashed.
    assert.equal(announcedRunStates[announcedRunStates.length - 1]!.status, FileWalkStatus.Idle);
    assert.equal(announcedRunStates.some((runState) => runState.status === FileWalkStatus.Crashed), false);
    // the pool reported no outcome.
    assert.deepEqual(reportedOutcomes, []);
});

test("test_reset_all_stores_leaves_the_store_folder_empty_when_a_repo_was_in_a_sub_folder", async (testContext) => {
    // Scenario: a repo sits in a sub folder of the store: after the reset of all stores the store holds nothing at all.
    // a store holds one repo at the top and one repo in the sub folder "tests".
    const storeFolder = makeTemporaryFolder(testContext);
    makeStampedRepoFolder(storeFolder, "geo_core.py.git");
    makeStampedRepoFolder(storeFolder, "tests/test_geo_core.py.git");
    // the reset of all stores is asked for.
    await resetAllStores(new Path(storeFolder), async () => {}, () => {});
    // the store folder still exists and holds nothing.
    assert.equal(existsSync(storeFolder), true);
    assert.deepEqual(readdirSync(storeFolder), []);
});

test("test_reset_of_one_file_removes_the_empty_parent_folders_of_its_repo", async (testContext) => {
    // Scenario: the only repo of a deep path is reset: the empty parent folders of that repo go too, the store stays.
    // a store holds one repo two folders deep.
    const storeFolder = makeTemporaryFolder(testContext);
    const repoFolder = makeStampedRepoFolder(storeFolder, "a/b/deep.py.git");
    const file = new Path("/project/a/b/deep.py");
    // the reset of that one file is asked for.
    await resetStoresOfFiles(new Path(storeFolder), [{ file, repoFolder: new Path(repoFolder) }], async () => {}, () => {});
    // the folder "a" does not exist any more, and the store folder still exists.
    assert.equal(existsSync(join(storeFolder, "a")), false);
    assert.equal(existsSync(storeFolder), true);
});

test("test_reset_of_one_file_keeps_a_parent_folder_that_holds_another_repo", async (testContext) => {
    // Scenario: two repos share a parent folder: the reset of one repo leaves the parent folder and the other repo.
    // a store holds two repos in the sub folder "tests".
    const storeFolder = makeTemporaryFolder(testContext);
    const oneRepoFolder = makeStampedRepoFolder(storeFolder, "tests/one.py.git");
    const twoRepoFolder = makeStampedRepoFolder(storeFolder, "tests/two.py.git");
    const file = new Path("/project/tests/one.py");
    // the reset of one.py is asked for.
    await resetStoresOfFiles(new Path(storeFolder), [{ file, repoFolder: new Path(oneRepoFolder) }], async () => {}, () => {});
    // the repo of one.py is gone.
    assert.equal(existsSync(oneRepoFolder), false);
    // the folder "tests" still exists and still holds the repo of two.py.
    assert.equal(existsSync(join(storeFolder, "tests")), true);
    assert.equal(existsSync(twoRepoFolder), true);
    assert.deepEqual(readdirSync(join(storeFolder, "tests")), ["two.py.git"]);
});

test("test_reset_all_stores_removes_an_empty_folder_that_held_no_repo", async (testContext) => {
    // Scenario: an old empty folder sits in the store: the reset of all stores removes it too.
    // a store holds one repo and one empty folder.
    const storeFolder = makeTemporaryFolder(testContext);
    makeStampedRepoFolder(storeFolder, "file.py.git");
    mkdirSync(join(storeFolder, "old_empty"));
    // the reset of all stores is asked for.
    await resetAllStores(new Path(storeFolder), async () => {}, () => {});
    // the store holds nothing.
    assert.deepEqual(readdirSync(storeFolder), []);
});
