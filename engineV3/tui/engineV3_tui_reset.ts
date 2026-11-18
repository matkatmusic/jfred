// The reset loop of the terminal viewer: wait for the child to exit, check the repo folder is inside the store, then remove it.

import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Path } from "../../src/structures/domain.ts";
import { assertStoreHoldsOnlyInverseRepos, listRepoFoldersOfStore, resetStore } from "../engineV3_step_store_guard.ts";

export type FileStore = { file: Path; repoFolder: Path };

export function assertRepoFolderIsInsideStore(repoFolder: Path, storeFolder: Path): void {
    if (existsSync(repoFolder.toString())) {
        if (lstatSync(repoFolder.toString()).isSymbolicLink()) {
            throw new Error(`Refusing to reset: the repo folder is a symbolic link: ${repoFolder.toString()}`);
        }
        const realRepoFolder = realpathSync(repoFolder.toString());
        const realStoreFolder = realpathSync(storeFolder.toString());
        if (!realRepoFolder.startsWith(realStoreFolder + "/")) {
            throw new Error(`Refusing to reset: the repo folder ${repoFolder.toString()} is outside the store ${storeFolder.toString()}`);
        }
    }
}

function removeEmptySubFoldersOf(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            const subFolder = join(folder, entry.name);
            removeEmptySubFoldersOf(subFolder);
            if (readdirSync(subFolder).length === 0) {
                rmdirSync(subFolder);
            }
        }
    }
}

export function removeEmptyFoldersInsideStore(storeFolder: Path): void {
    removeEmptySubFoldersOf(storeFolder.toString());
}

export function removeEmptyParentFoldersOfRepo(repoFolder: Path, storeFolder: Path): void {
    const storeFolderText = resolve(storeFolder.toString());
    let parentFolder = dirname(resolve(repoFolder.toString()));
    while (parentFolder.startsWith(storeFolderText + "/")) {
        if (readdirSync(parentFolder).length !== 0) {
            break;
        }
        rmdirSync(parentFolder);
        parentFolder = dirname(parentFolder);
    }
}

export async function resetStoresOfFiles(
    storeFolder: Path,
    fileStores: FileStore[],
    cancelFile: (file: Path) => Promise<void>,
    clearFileState: (file: Path) => void,
): Promise<void> {
    for (const fileStore of fileStores) {
        await cancelFile(fileStore.file);
        assertRepoFolderIsInsideStore(fileStore.repoFolder, storeFolder);
        resetStore(fileStore.repoFolder);
        removeEmptyParentFoldersOfRepo(fileStore.repoFolder, storeFolder);
        clearFileState(fileStore.file);
    }
}

export async function resetAllStores(storeFolder: Path, cancelAll: () => Promise<void>, clearAllFileStates: () => void): Promise<void> {
    await cancelAll();
    assertStoreHoldsOnlyInverseRepos(storeFolder);
    // for (const repoFolder of listRepoFoldersOfStore(storeFolder)) {
    //     assertRepoFolderIsInsideStore(repoFolder, storeFolder);
    //     resetStore(repoFolder);
    // }
    const repoFolders = listRepoFoldersOfStore(storeFolder);
    for (const repoFolder of repoFolders) {
        assertRepoFolderIsInsideStore(repoFolder, storeFolder);
    }
    for (const repoFolder of repoFolders) {
        resetStore(repoFolder);
    }
    removeEmptyFoldersInsideStore(storeFolder);
    clearAllFileStates();
}
