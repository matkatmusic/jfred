// Reads the inverse repos of a project: the state of a file at one instant, and the difference between two instants.

import { existsSync } from "node:fs";
import { basename } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { StateMoment } from "./engineV3_file_known_states.ts";
import { listInverseCommits, type InverseCommit } from "./engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile } from "./engineV3_inverse_repos_for_project.ts";

export type ProjectFileStateAtInstant = { file: Path; commit: InverseCommit | undefined };

// An at-event state holds from its instant on; a before-event state holds until its instant, from the next older commit on.
export function getInverseCommitAtInstant(repoFolder: Path, fileName: string, instant: Date): InverseCommit | undefined {
    const commits = listInverseCommits(repoFolder, fileName);
    for (const [index, commit] of commits.entries()) {
        if (commit.instant !== undefined) {
            if (commit.instant.getTime() <= instant.getTime()) {
                if (commit.moment === StateMoment.AtEvent) {
                    return commit;
                }
                const newerCommit = commits[index - 1];
                if (newerCommit !== undefined) {
                    if (newerCommit.moment === StateMoment.BeforeEvent) {
                        return newerCommit;
                    }
                }
                return undefined;
            }
        }
    }
    return undefined;
}

export function getDiffTextBetweenInstants(repoFolder: Path, fileName: string, olderInstant: Date, newerInstant: Date): string {
    const olderCommit = getInverseCommitAtInstant(repoFolder, fileName, olderInstant);
    if (olderCommit === undefined) {
        throw new Error(`getDiffTextBetweenInstants: no commit of ${fileName} holds the state at ${olderInstant.toISOString()}`);
    }
    const newerCommit = getInverseCommitAtInstant(repoFolder, fileName, newerInstant);
    if (newerCommit === undefined) {
        throw new Error(`getDiffTextBetweenInstants: no commit of ${fileName} holds the state at ${newerInstant.toISOString()}`);
    }
    return executeGit(repoFolder, ["diff", "--no-color", olderCommit.commitHash.toString(), newerCommit.commitHash.toString()]).toString("utf8");
}

export function listProjectFileStatesAtInstant(storeFolder: Path, projectFolder: Path, files: Path[], instant: Date): ProjectFileStateAtInstant[] {
    const fileStates: ProjectFileStateAtInstant[] = [];
    for (const file of files) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
        if (!existsSync(repoFolder.toString())) {
            throw new Error(`listProjectFileStatesAtInstant: the repo folder ${repoFolder.toString()} of ${file.toString()} does not exist`);
        }
        const commit = getInverseCommitAtInstant(repoFolder, basename(file.toString()), instant);
        fileStates.push({ file, commit });
    }
    return fileStates;
}
