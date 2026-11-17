// Walks the other replay-list files to the end of their step repos, for the replay command.

import { basename } from "node:path";
import type { Path } from "../src/structures/domain.ts";
import type { ProgressSink } from "../src/parse/loadTranscript.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import type { FileKnownState } from "./engineV3_file_known_states.ts";
import { createFileStep } from "./engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "./engineV3_file_step_write.ts";
import { listInverseCommitsFromWalkedStates } from "./engineV3_inverse_commits_from_states.ts";
import { listInverseCommits, type InverseCommit } from "./engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, getRelativePathInProject, listStatesOfProjectFile, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";

export type WalkedOtherFile = { file: Path; commits: InverseCommit[] };

const PROGRESS_ROW_NAME = "other files";

export function walkOtherFilesToTheEnd(input: { projectFolder: Path; replayFiles: ProjectFile[]; replayedProjectFile: ProjectFile; storeFolder: Path; transcriptsToParse: Path[]; fileHistoryFolder: Path; reportProgress: ProgressSink }): WalkedOtherFile[] {
    const { projectFolder, replayFiles, replayedProjectFile, storeFolder, transcriptsToParse, fileHistoryFolder, reportProgress } = input;
    const otherFiles = replayFiles.filter((projectFile) => !projectFile.file.equals(replayedProjectFile.file));
    buildOnDemandInverseReposForFiles(projectFolder, otherFiles, transcriptsToParse, storeFolder, new Date(), () => {});
    const getEvents = createProjectEventsLoader(replayFiles, transcriptsToParse, [fileHistoryFolder]);
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
                    throw new Error(`walkOtherFilesToTheEnd: ${projectFile.file.toString()} is born from the replayed file`);
                }
            }
        }
        listStatesOfProjectFile(index, replayFiles, getEvents, statesByFile, fileIndexesBeingComputed);
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
        const fileName = basename(projectFile.file.toString());
        const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
        let outcome: InverseStepOutcome | undefined;
        while (outcome !== InverseStepOutcome.NoOlderChange) {
            outcome = stepFileAndWriteCommit(repoFolder, fileName, step, undefined).result.outcome;
        }
        const commits = listInverseCommitsFromWalkedStates(step.walk.knownStates, listInverseCommits(repoFolder, fileName, true));
        walkedFiles.push({ file: projectFile.file, commits });
        const doneCount = walkedFiles.length;
        const relativePath = getRelativePathInProject(projectFolder, projectFile.file);
        reportProgress({ kind: DocumentResponseKind.progress, label: `${PROGRESS_ROW_NAME} ${doneCount}/${otherFiles.length} ${relativePath}`, current: doneCount, total: otherFiles.length, file: PROGRESS_ROW_NAME, fileStepsDone: doneCount, fileStepsTotal: otherFiles.length });
    }
    return walkedFiles;
}
