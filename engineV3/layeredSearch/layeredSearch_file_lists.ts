// The first file list of the layered search: the files on disk in the project, and the files any git commit touched.

import { execFileSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { listCurrentFileState } from "../../src/layer1_disk_walk.ts";
import { Path } from "../../src/structures/domain.ts";

export function listProjectFilePaths(projectFolder: Path): string[] {
    return listCurrentFileState(projectFolder).map((fileState) => fileState.relativePath.toString());
}

export function listGitTouchedFilePaths(repoFolder: Path, projectFolder: Path, isOutsideProjectIncluded: boolean): string[] {
    const output = execFileSync("git", ["log", "--all", "--no-renames", "--name-only", "--pretty=format:", "-z"], {
        cwd: repoFolder.toString(),
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
    });
    const paths: string[] = [];
    for (const repoRelativePath of output.split("\0")) {
        if (repoRelativePath !== "") {
            const projectRelativePath = relative(projectFolder.toString(), join(repoFolder.toString(), repoRelativePath));
            const isInsideProject = projectRelativePath.split(sep)[0] !== "..";
            if (isInsideProject) {
                paths.push(projectRelativePath);
            }
            else {
                if (isOutsideProjectIncluded) {
                    paths.push(projectRelativePath);
                }
            }
        }
    }
    return paths;
}

// Two relative paths can name the same file (src/a.ts and ../jot/src/a.ts): the Set drops that duplicate once both are absolute.
export function convertToAbsoluteFilePaths(relativePaths: string[], projectFolder: Path): string[] {
    const absolutePaths = new Set<string>();
    for (const relativePath of relativePaths) {
        absolutePaths.add(resolve(projectFolder.toString(), relativePath));
    }
    return [...absolutePaths].sort();
}

export function mergeFilePathsWithoutDuplicates(firstPaths: string[], secondPaths: string[]): string[] {
    return [...new Set([...firstPaths, ...secondPaths])].sort();
}
