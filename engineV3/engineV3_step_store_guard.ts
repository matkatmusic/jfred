// Guards that keep the step program from writing outside the cache folder or over a full-build repo.

// import { existsSync, realpathSync } from "node:fs";
import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
// import type { Path } from "../src/structures/domain.ts";
import { Path } from "../src/structures/domain.ts";
// import { getInverseRepoFolderForFile, isInverseRepoOnDemand, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { STAMP_FILE_NAME, getInverseRepoFolderForFile, isInverseRepoOnDemand, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";

// realpathSync follows a symbolic link in the cache folder that points outside it.
export function assertStoreIsInsideCacheFolder(storeFolder: Path, cacheFolder: Path): void {
    const realStoreFolder = realpathSync(storeFolder.toString());
    const realCacheFolder = realpathSync(cacheFolder.toString());
    if (!realStoreFolder.startsWith(realCacheFolder + "/")) {
        throw new Error(`assertStoreIsInsideCacheFolder: the store ${realStoreFolder} is not inside the cache folder ${realCacheFolder}`);
    }
}

export function assertStoreHasNoFullBuildRepos(storeFolder: Path, projectFolder: Path, projectFiles: ProjectFile[]): void {
    for (const { file } of projectFiles) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
        if (existsSync(repoFolder.toString())) {
            if (!isInverseRepoOnDemand(repoFolder)) {
                throw new Error(`assertStoreHasNoFullBuildRepos: the store holds a full-build repo of ${file.toString()}: use another --store`);
            }
        }
    }
}

// readdirSync with file types does not follow links, so a symbolic link shows up as a link.
export function assertRepoFolderHoldsOnlyOwnContent(repoFolder: string): void {
    for (const entry of readdirSync(repoFolder, { recursive: true, withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
            throw new Error(`assertStoreHoldsOnlyInverseRepos: ${join(entry.parentPath, entry.name)} is a symbolic link, not part of a repo`);
        }
    }
    if (!existsSync(join(repoFolder, STAMP_FILE_NAME))) {
        throw new Error(`assertStoreHoldsOnlyInverseRepos: ${repoFolder} has no ${STAMP_FILE_NAME}, not part of a repo`);
    }
}

function assertFolderHoldsOnlyInverseRepos(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const entryPath = join(folder, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`assertStoreHoldsOnlyInverseRepos: ${entryPath} is a symbolic link, not part of a repo`);
        }
        if (!entry.isDirectory()) {
            throw new Error(`assertStoreHoldsOnlyInverseRepos: ${entryPath} is not part of a repo`);
        }
        if (entry.name.endsWith(".git")) {
            assertRepoFolderHoldsOnlyOwnContent(entryPath);
        } else {
            assertFolderHoldsOnlyInverseRepos(entryPath);
        }
    }
}

export function assertStoreHoldsOnlyInverseRepos(storeFolder: Path): void {
    if (existsSync(storeFolder.toString())) {
        assertFolderHoldsOnlyInverseRepos(storeFolder.toString());
    }
}

// Checks the one repo folder first, then removes it: a refused repo loses nothing.
export function resetStore(repoFolder: Path): void {
    if (existsSync(repoFolder.toString())) {
        assertRepoFolderHoldsOnlyOwnContent(repoFolder.toString());
        rmSync(repoFolder.toString(), { recursive: true, force: true });
    }
}

function listRepoFoldersInFolder(folder: string): Path[] {
    const repoFolders: Path[] = [];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const entryPath = join(folder, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.endsWith(".git")) {
                repoFolders.push(new Path(entryPath));
            } else {
                repoFolders.push(...listRepoFoldersInFolder(entryPath));
            }
        }
    }
    return repoFolders;
}

export function listRepoFoldersOfStore(storeFolder: Path): Path[] {
    if (existsSync(storeFolder.toString())) {
        return listRepoFoldersInFolder(storeFolder.toString());
    }
    return [];
}

// Checks the whole store first, then removes: a refused store loses nothing.
export function resetStoreFolder(storeFolder: Path): void {
    assertStoreHoldsOnlyInverseRepos(storeFolder);
    if (existsSync(storeFolder.toString())) {
        for (const name of readdirSync(storeFolder.toString())) {
            rmSync(join(storeFolder.toString(), name), { recursive: true, force: true });
        }
    }
}
