// The --resetStore guard: a store is emptied only when it holds nothing but stamped repos.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
// import { resetStoreFolder } from "../engineV3/engineV3_step_store_guard.ts";
import { forceResetStoreFolder, listRepoFoldersOfStore, resetStore, resetStoreFolder } from "../engineV3/engineV3_step_store_guard.ts";

const STAMP_FILE_NAME = "jfred-stamp.json";

function makeTemporaryFolder(t: TestContext): string {
    const folder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-store-reset-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function writeStampedRepo(repoFolder: string): void {
    mkdirSync(join(repoFolder, "objects"), { recursive: true });
    writeFileSync(join(repoFolder, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(repoFolder, "objects", "pack"), "pack");
    writeFileSync(join(repoFolder, STAMP_FILE_NAME), "{}");
}

test("test_store_of_stamped_repos_is_emptied_and_the_store_folder_stays", (t) => {
    // Scenario: a store holds one repo at its top and one repo inside a plain subfolder.
    // Steps:
    // the store holds a.ts.git and src/deep/b.ts.git, both stamped.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    writeStampedRepo(join(storeFolder, "a.ts.git"));
    writeStampedRepo(join(storeFolder, "src", "deep", "b.ts.git"));
    // the reset runs.
    resetStoreFolder(new Path(storeFolder));
    // the store folder still exists and holds nothing.
    assert.equal(existsSync(storeFolder), true);
    assert.deepEqual(readdirSync(storeFolder), []);
});

test("test_missing_store_folder_passes", (t) => {
    // Scenario: the store folder does not exist yet.
    // Steps:
    // the store path points at nothing.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    // the reset does not throw.
    resetStoreFolder(new Path(storeFolder));
    // the reset did not create the folder.
    assert.equal(existsSync(storeFolder), false);
});

test("test_empty_store_folder_passes", (t) => {
    // Scenario: the store folder exists and is empty.
    // Steps:
    // an empty store folder.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    mkdirSync(storeFolder);
    // the reset does not throw.
    resetStoreFolder(new Path(storeFolder));
    // the folder is still there, still empty.
    assert.deepEqual(readdirSync(storeFolder), []);
});

test("test_store_with_one_foreign_file_throws_and_removes_nothing", (t) => {
    // Scenario: one file that is not inside a repo makes the whole reset refuse.
    // Steps:
    // the store holds a stamped repo and a loose file notes.txt.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    writeStampedRepo(join(storeFolder, "a.ts.git"));
    const foreignFile = join(storeFolder, "notes.txt");
    writeFileSync(foreignFile, "keep me");
    // the reset throws and the message names the foreign file.
    assert.throws(() => resetStoreFolder(new Path(storeFolder)), (error: Error) => error.message.includes(foreignFile));
    // every file is still there.
    assert.equal(readFileSync(foreignFile, "utf8"), "keep me");
    assert.equal(existsSync(join(storeFolder, "a.ts.git", STAMP_FILE_NAME)), true);
    assert.equal(existsSync(join(storeFolder, "a.ts.git", "objects", "pack")), true);
});

test("test_git_folder_without_stamp_throws_and_removes_nothing", (t) => {
    // Scenario: a folder named like a repo but without the stamp file is not ours.
    // Steps:
    // the store holds a stamped repo and a folder other.git with a file but no stamp.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    writeStampedRepo(join(storeFolder, "a.ts.git"));
    const unstampedFolder = join(storeFolder, "other.git");
    mkdirSync(unstampedFolder);
    writeFileSync(join(unstampedFolder, "HEAD"), "x");
    // the reset throws and the message names the unstamped folder.
    assert.throws(() => resetStoreFolder(new Path(storeFolder)), (error: Error) => error.message.includes(unstampedFolder));
    // every file is still there.
    assert.equal(existsSync(join(unstampedFolder, "HEAD")), true);
    assert.equal(existsSync(join(storeFolder, "a.ts.git", STAMP_FILE_NAME)), true);
});

test("test_symlink_under_the_store_throws_and_removes_nothing_and_target_is_untouched", (t) => {
    // Scenario: a symlink in the store is foreign content and is never followed.
    // Steps:
    // a folder outside the store holds a file.
    const rootFolder = makeTemporaryFolder(t);
    const targetFolder = join(rootFolder, "target");
    mkdirSync(targetFolder);
    writeFileSync(join(targetFolder, "precious.txt"), "precious");
    // the store holds a stamped repo and a symlink to that folder.
    const storeFolder = join(rootFolder, "store");
    writeStampedRepo(join(storeFolder, "a.ts.git"));
    const linkPath = join(storeFolder, "link.git");
    symlinkSync(targetFolder, linkPath);
    // the reset throws and the message names the symlink.
    assert.throws(() => resetStoreFolder(new Path(storeFolder)), (error: Error) => error.message.includes(linkPath));
    // the symlink and the repo are still there, and the target is untouched.
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(existsSync(join(storeFolder, "a.ts.git", STAMP_FILE_NAME)), true);
    assert.equal(readFileSync(join(targetFolder, "precious.txt"), "utf8"), "precious");
});

test("test_forceResetStoreFolder_empties_a_store_that_holds_a_git_folder_without_a_stamp", (t) => {
    // Scenario: the user chose "reset the store" after the TUI found a full-build repo, which is a git folder without a stamp.
    // the store holds a.ts.git without a stamp and src/b.ts.git with a stamp.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    mkdirSync(join(storeFolder, "a.ts.git"), { recursive: true });
    writeStampedRepo(join(storeFolder, "src", "b.ts.git"));
    // the forced reset runs and does not throw.
    forceResetStoreFolder(new Path(storeFolder));
    // the store folder still exists and holds nothing.
    assert.equal(existsSync(storeFolder), true);
    assert.deepEqual(readdirSync(storeFolder), []);
});
test("test_resetStore_removes_one_repo_and_leaves_the_others", (t) => {
    // Scenario: resetStore removes exactly the repo folder it is given.
    // Steps:
    // the store holds two stamped repos, a.ts.git and src/b.ts.git.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    const firstRepoFolder = join(storeFolder, "a.ts.git");
    const secondRepoFolder = join(storeFolder, "src", "b.ts.git");
    writeStampedRepo(firstRepoFolder);
    writeStampedRepo(secondRepoFolder);
    // resetStore runs on the first repo.
    resetStore(new Path(firstRepoFolder));
    // the first repo folder is gone.
    assert.equal(existsSync(firstRepoFolder), false);
    // the second repo is untouched.
    assert.equal(existsSync(join(secondRepoFolder, STAMP_FILE_NAME)), true);
    assert.equal(existsSync(join(secondRepoFolder, "objects", "pack")), true);
});

test("test_resetStore_throws_on_a_symbolic_link_and_removes_nothing", (t) => {
    // Scenario: a symbolic link inside the repo folder makes resetStore refuse.
    // Steps:
    // a folder outside the store holds a file.
    const rootFolder = makeTemporaryFolder(t);
    const targetFolder = join(rootFolder, "target");
    mkdirSync(targetFolder);
    writeFileSync(join(targetFolder, "precious.txt"), "precious");
    // the store holds a stamped repo with a symbolic link to that folder inside it.
    const repoFolder = join(rootFolder, "store", "a.ts.git");
    writeStampedRepo(repoFolder);
    const linkPath = join(repoFolder, "link");
    symlinkSync(targetFolder, linkPath);
    // resetStore throws and the message names the symbolic link.
    assert.throws(() => resetStore(new Path(repoFolder)), (error: Error) => error.message.includes(linkPath));
    // the repo, the link and the target are still there.
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(existsSync(join(repoFolder, STAMP_FILE_NAME)), true);
    assert.equal(readFileSync(join(targetFolder, "precious.txt"), "utf8"), "precious");
});

test("test_resetStore_throws_on_a_folder_without_a_stamp", (t) => {
    // Scenario: a folder without the stamp file is not ours, so resetStore refuses it.
    // Steps:
    // the store holds other.git with a file but no stamp.
    const unstampedFolder = join(makeTemporaryFolder(t), "store", "other.git");
    mkdirSync(unstampedFolder, { recursive: true });
    writeFileSync(join(unstampedFolder, "HEAD"), "x");
    // resetStore throws and the message names the folder.
    assert.throws(() => resetStore(new Path(unstampedFolder)), (error: Error) => error.message.includes(unstampedFolder));
    // the file is still there.
    assert.equal(readFileSync(join(unstampedFolder, "HEAD"), "utf8"), "x");
});

test("test_resetStore_of_a_missing_folder_does_nothing", (t) => {
    // Scenario: the repo folder does not exist.
    // Steps:
    // the repo folder path points at nothing.
    const missingRepoFolder = join(makeTemporaryFolder(t), "store", "a.ts.git");
    // resetStore does not throw.
    resetStore(new Path(missingRepoFolder));
    // resetStore did not create the folder.
    assert.equal(existsSync(missingRepoFolder), false);
});

test("test_listRepoFoldersOfStore_returns_every_repo_folder_at_any_depth", (t) => {
    // Scenario: the lister finds repo folders at the top of the store and inside plain subfolders.
    // Steps:
    // the store holds a.ts.git, src/b.ts.git and src/deep/c.ts.git.
    const storeFolder = join(makeTemporaryFolder(t), "store");
    const expectedRepoFolders = [join(storeFolder, "a.ts.git"), join(storeFolder, "src", "b.ts.git"), join(storeFolder, "src", "deep", "c.ts.git")];
    for (const repoFolder of expectedRepoFolders) {
        writeStampedRepo(repoFolder);
    }
    // the lister runs on the store.
    const repoFolders = listRepoFoldersOfStore(new Path(storeFolder));
    // it returns exactly those three folders, as paths, and no folder inside a repo.
    assert.ok(repoFolders.every((repoFolder) => repoFolder instanceof Path));
    assert.deepEqual(repoFolders.map((repoFolder) => repoFolder.toString()).sort(), [...expectedRepoFolders].sort());
});
