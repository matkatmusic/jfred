// The read-only twin of walkOtherFilesToTheEnd: the other files must already be walked to their end, and nothing is written.

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import type { FileKnownState } from "./engineV3_file_known_states.ts";
import { createFileStep, stepFileToNextTextChange } from "./engineV3_file_step.ts";
import { listInverseCommitsFromWalkedStates } from "./engineV3_inverse_commits_from_states.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { createProjectEventsLoader, getInverseRepoFolderForFile, getRelativePathInProject, listStatesOfProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import type { WalkedOtherFile, WalkOtherFilesInput } from "./engineV3_step_other_files.ts";
import { readWalkCoverage } from "./engineV3_walk_coverage.ts";

export type FinishedOtherFiles = { walkedFiles: WalkedOtherFile[]; refusalReason: string | undefined };

const PROGRESS_ROW_NAME = "other files";

function createNotWalkedRefusal(relativePath: string): FinishedOtherFiles {
    return { walkedFiles: [], refusalReason: `the repo of ${relativePath} is not walked to its end: the TUI walks every file to its end before a play` };
}

export function readOtherFilesWalkedToTheEnd(input: WalkOtherFilesInput): FinishedOtherFiles {
    const { projectFolder, replayFiles, replayedProjectFile, storeFolder, transcriptsToParse, fileHistoryFolders, reportProgress, earliestBoundary } = input;
    const otherFiles = replayFiles.filter((projectFile) => !projectFile.file.equals(replayedProjectFile.file));
    for (const projectFile of otherFiles) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
        const relativePath = getRelativePathInProject(projectFolder, projectFile.file);
        if (!existsSync(repoFolder.toString())) {
            return createNotWalkedRefusal(relativePath);
        }
        const coverage = readWalkCoverage(repoFolder);
        if (coverage === undefined) {
            return createNotWalkedRefusal(relativePath);
        }
        if (!coverage.isFinished) {
            return createNotWalkedRefusal(relativePath);
        }
    }
    const getEvents = createProjectEventsLoader(replayFiles, transcriptsToParse, fileHistoryFolders, earliestBoundary);
    const statesByFile: (FileKnownState[] | undefined)[] = replayFiles.map(() => undefined);
    const fileIndexesBeingComputed = new Set<number>();
    const walkedFiles: WalkedOtherFile[] = [];
    for (const projectFile of otherFiles) {
        const index = replayFiles.indexOf(projectFile);
        const events = getEvents(index);
        const oldestEvent = events[events.length - 1];
        if (oldestEvent !== undefined) {
            if (oldestEvent.moveOrCopySourceFile !== undefined) {
                if (oldestEvent.moveOrCopySourceFile.equals(replayedProjectFile.transcriptFile)) {
                    throw new Error(`readOtherFilesWalkedToTheEnd: ${projectFile.file.toString()} is born from the replayed file`);
                }
            }
        }
        listStatesOfProjectFile(index, replayFiles, getEvents, statesByFile, fileIndexesBeingComputed);
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
        const fileName = basename(projectFile.file.toString());
        const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
        let outcome: InverseStepOutcome | undefined;
        while (outcome !== InverseStepOutcome.NoOlderChange) {
            const result = stepFileToNextTextChange(step, undefined);
            if (result.writtenState !== undefined) {
                throw new Error(`readOtherFilesWalkedToTheEnd: the repo of ${projectFile.file.toString()} is marked finished, but the walk finds a text that is not stored`);
            }
            outcome = result.outcome;
        }
        const commits = listInverseCommitsFromWalkedStates(step.walk.knownStates, listInverseCommits(repoFolder, fileName, true));
        walkedFiles.push({ file: projectFile.file, commits });
        const doneCount = walkedFiles.length;
        const relativePath = getRelativePathInProject(projectFolder, projectFile.file);
        reportProgress({ kind: DocumentResponseKind.progress, label: `${PROGRESS_ROW_NAME} ${doneCount}/${otherFiles.length} ${relativePath}`, current: doneCount, total: otherFiles.length, file: PROGRESS_ROW_NAME, fileStepsDone: doneCount, fileStepsTotal: otherFiles.length });
    }
    return { walkedFiles, refusalReason: undefined };
}
