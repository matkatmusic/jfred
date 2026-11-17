// The project as a script saw it just before its instant: repo commits plus the texts earlier steps of the same pass produced.

import { existsSync } from "node:fs";
import { basename, relative, sep } from "node:path";

import type { Path } from "../src/structures/domain.ts";
import { listInverseCommits, type InverseCommit } from "./engineV3_inverse_repo.ts";
import { selectInverseCommitAtInstant } from "./engineV3_inverse_repo_read.ts";
import { getInverseRepoFolderForFile, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { ScriptReplayInputKind, type ScriptReplayInputFile } from "./engineV3_script_replay_container.ts";

// An undefined text means the step left the file absent.
type InPassText = { instant: Date; text: string | undefined };

enum ChosenStateKind { InPass, Repo }
type ChosenState =
    | { kind: ChosenStateKind.InPass; inPassText: InPassText }
    | { kind: ChosenStateKind.Repo; commit: InverseCommit };

function formatSlashPath(fromFolder: Path, toPath: Path): string {
    return relative(fromFolder.toString(), toPath.toString()).split(sep).join("/");
}

export class ReplayWorkspace {
    readonly storeFolder: Path;
    readonly projectFolder: Path;
    readonly recordedProjectFolder: Path;
    readonly projectFiles: ProjectFile[];
    private readonly commitsByFile = new Map<string, InverseCommit[]>();
    private readonly inPassTextsByFile = new Map<string, InPassText[]>();

    constructor(storeFolder: Path, projectFolder: Path, recordedProjectFolder: Path, projectFiles: ProjectFile[]) {
        this.storeFolder = storeFolder;
        this.projectFolder = projectFolder;
        this.recordedProjectFolder = recordedProjectFolder;
        this.projectFiles = projectFiles;
    }

    listInputFilesJustBefore(instant: Date): ScriptReplayInputFile[] {
        const inputFiles: ScriptReplayInputFile[] = [];
        for (const projectFile of this.projectFiles) {
            const chosenState = this.chooseStateJustBefore(projectFile.file, instant);
            if (chosenState !== undefined) {
                const relativePath = formatSlashPath(this.projectFolder, projectFile.file);
                if (chosenState.kind === ChosenStateKind.InPass) {
                    if (chosenState.inPassText.text !== undefined) {
                        inputFiles.push({ relativePath, source: { kind: ScriptReplayInputKind.Text, text: chosenState.inPassText.text } });
                    }
                } else {
                    if (!chosenState.commit.isFileAbsent) {
                        const repoFolder = getInverseRepoFolderForFile(this.storeFolder, this.projectFolder, projectFile.file);
                        const repoRelativePath = formatSlashPath(this.storeFolder, repoFolder);
                        inputFiles.push({ relativePath, source: { kind: ScriptReplayInputKind.Store, repoRelativePath, commitHash: chosenState.commit.commitHash.toString() } });
                    }
                }
            }
        }
        return inputFiles;
    }

    getTextJustBefore(file: Path, instant: Date): string | undefined {
        const chosenState = this.chooseStateJustBefore(file, instant);
        if (chosenState === undefined) {
            return undefined;
        }
        if (chosenState.kind === ChosenStateKind.InPass) {
            return chosenState.inPassText.text;
        }
        return chosenState.commit.text;
    }

    recordTextAfterStep(file: Path, instant: Date, text: string | undefined): void {
        const inPassTexts = this.inPassTextsByFile.get(file.toString()) ?? [];
        const otherTexts = inPassTexts.filter((inPassText) => inPassText.instant.getTime() !== instant.getTime());
        otherTexts.push({ instant, text });
        otherTexts.sort((left, right) => left.instant.getTime() - right.instant.getTime());
        this.inPassTextsByFile.set(file.toString(), otherTexts);
    }

    clearInPassTexts(file: Path): void {
        this.inPassTextsByFile.delete(file.toString());
    }

    refreshRepo(file: Path): void {
        this.commitsByFile.delete(file.toString());
    }

    setCommits(file: Path, commits: InverseCommit[]): void {
        this.commitsByFile.set(file.toString(), commits);
    }

    private listCommits(file: Path): InverseCommit[] {
        const cachedCommits = this.commitsByFile.get(file.toString());
        if (cachedCommits !== undefined) {
            return cachedCommits;
        }
        const repoFolder = getInverseRepoFolderForFile(this.storeFolder, this.projectFolder, file);
        if (!existsSync(repoFolder.toString())) {
            throw new Error(`ReplayWorkspace.listCommits: the repo folder ${repoFolder.toString()} of ${file.toString()} does not exist`);
        }
        const commits = listInverseCommits(repoFolder, basename(file.toString()));
        this.commitsByFile.set(file.toString(), commits);
        return commits;
    }

    private findNewestInPassTextAtOrBefore(file: Path, instant: Date): InPassText | undefined {
        const inPassTexts = this.inPassTextsByFile.get(file.toString()) ?? [];
        for (let index = inPassTexts.length - 1; index >= 0; index--) {
            const inPassText = inPassTexts[index]!;
            if (inPassText.instant.getTime() <= instant.getTime()) {
                return inPassText;
            }
        }
        return undefined;
    }

    private chooseStateJustBefore(file: Path, instant: Date): ChosenState | undefined {
        const justBefore = new Date(instant.getTime() - 1);
        const commit = selectInverseCommitAtInstant(this.listCommits(file), justBefore);
        const inPassText = this.findNewestInPassTextAtOrBefore(file, justBefore);
        if (inPassText !== undefined) {
            if (commit === undefined) {
                return { kind: ChosenStateKind.InPass, inPassText };
            }
            if (commit.instant === undefined) {
                throw new Error(`ReplayWorkspace.chooseStateJustBefore: the chosen commit ${commit.commitHash.toString()} of ${file.toString()} has no instant`);
            }
            if (inPassText.instant.getTime() >= commit.instant.getTime()) {
                return { kind: ChosenStateKind.InPass, inPassText };
            }
        }
        if (commit === undefined) {
            return undefined;
        }
        return { kind: ChosenStateKind.Repo, commit };
    }
}
