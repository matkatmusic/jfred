// The /api/layer1-inverse-repos wire: the inverse repo of every project file, as commit metadata without file text.

import { execFileSync } from "node:child_process";
// import { basename, relative } from "node:path";
import { basename } from "node:path";
// import { buildInverseReposForFiles, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { buildInverseReposForFiles, getRelativePathInProject, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { listInverseCommits, type InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
// import { listProjectFilesOnDiskAndInLogs } from "../engineV3/engineV3_inverse_repos_project_files.ts";
import { listLayeredSearchProjectFiles } from "../engineV3/layeredSearch/layeredSearch_project_files.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
// import { listCurrentFileState } from "./layer1_disk_walk.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS = "building inverse repos";

export type InverseCommitWire = {
    commitHash: string;
    treeHash: string;
    eventType: string;
    moment: string;
    confidence: string;
    position: number;
    instant: string | null;
    readerInstant: string | null;
    isFileAbsent: boolean;
    isRemoved: boolean;
    movedAwayTo: string | null;
};

export type InverseRepoFileWire = { file: string; commits: InverseCommitWire[] };

export type InverseReposWire = { files: InverseRepoFileWire[] };

export type InverseStateWire = { file: string; commit: InverseCommitWire | null; text: string | null };

export type InverseDiffWire = { file: string; diff: string };

export function buildInverseCommitWire(commit: InverseCommit): InverseCommitWire {
    // The page reads a null instant of the DiskNow commit as row 0.
    let instant: string | null = null;
    if (commit.instant !== undefined) {
        if (commit.eventType !== FileEventType.DiskNow) {
            instant = commit.instant.toISOString();
        }
    }
    return {
        commitHash: commit.commitHash.toString(),
        treeHash: commit.treeHash.toString(),
        eventType: commit.eventType,
        moment: commit.moment,
        confidence: commit.confidence,
        position: commit.position,
        instant,
        readerInstant: commit.instant === undefined ? null : commit.instant.toISOString(),
        isFileAbsent: commit.isFileAbsent,
        isRemoved: commit.removedByScript,
        movedAwayTo: commit.movedAwayToFile === undefined ? null : commit.movedAwayToFile.toString(),
    };
}

export function buildInverseReposWire(
    projectFolder: Path,
    jsonlFolders: Path[],
    snapshotFolders: Path[],
    storeFolder: Path,
    reportProgress: ProgressSink = () => {},
): InverseReposWire {
    // const relativePaths = listCurrentFileState(projectFolder).map((fileState) => fileState.relativePath.toString());
    // const projectFiles: ProjectFile[] = relativePaths.map((relativePath) => {
    //     const file = new Path(join(projectFolder.toString(), relativePath));
    //     return { file, transcriptFile: file };
    // });
    // const projectFiles: ProjectFile[] = listProjectFilesOnDiskAndInLogs(projectFolder, jsonlFolders, reportProgress);
    const repoFolder = new Path(execFileSync("git", ["-C", projectFolder.toString(), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
    const { projectFiles, transcriptsToParse }: { projectFiles: ProjectFile[]; transcriptsToParse: Path[] } = listLayeredSearchProjectFiles(projectFolder, repoFolder, jsonlFolders, false, reportProgress);
    reportProgress({
        kind: DocumentResponseKind.progress,
        label: LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS,
        current: 0,
        total: projectFiles.length,
        steps: [LAYER1_PROGRESS_LABEL_BUILDING_INVERSE_REPOS],
    });
    // const results = buildInverseReposForFiles(projectFolder, projectFiles, jsonlFolders, snapshotFolders, storeFolder, new Date(), reportProgress);
    const results = buildInverseReposForFiles(projectFolder, projectFiles, transcriptsToParse, snapshotFolders, storeFolder, new Date(), reportProgress);
    const files: InverseRepoFileWire[] = [];
    for (const [index, result] of results.entries()) {
        // const commits = listInverseCommits(result.repoFolder, basename(result.file.toString())).map(buildInverseCommitWire);
        const commits = listInverseCommits(result.repoFolder, basename(result.file.toString()), false).map(buildInverseCommitWire);
        // files.push({ file: relative(projectFolder.toString(), result.file.toString()), commits });
        files.push({ file: getRelativePathInProject(projectFolder, result.file), commits });
    }
    return { files };
}
