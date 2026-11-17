// Guards that keep the step program from writing outside the cache folder or over a full-build repo.

import { existsSync, realpathSync } from "node:fs";
import type { Path } from "../src/structures/domain.ts";
import { getInverseRepoFolderForFile, isInverseRepoOnDemand, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";

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
