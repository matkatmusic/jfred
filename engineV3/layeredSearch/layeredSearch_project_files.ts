// Layered search as a function: list the project files and the logs to parse, without timing, printing or a JSON file.

import { execFileSync } from "node:child_process";
import type { ProgressSink } from "../../src/parse/loadTranscript.ts";
import { Path } from "../../src/structures/domain.ts";
import type { ProjectFile } from "../engineV3_inverse_repos_for_project.ts";
// import { convertToAbsoluteFilePaths, listGitTouchedFilePaths, listProjectFilePaths, mergeFilePathsWithoutDuplicates } from "./layeredSearch_file_lists.ts";
import { convertToAbsoluteFilePaths, listGitTouchedFilePaths, listProjectFilePaths, mergeFilePathsWithoutDuplicates, removeFolderPathsFromFilePaths } from "./layeredSearch_file_lists.ts";
// import { filterTranscriptsByCwd } from "./layeredSearch_filter_transcripts.ts";
import { filterTranscriptsByCwdOrFilePath } from "./layeredSearch_filter_transcripts.ts";
import { findCandidateTranscripts } from "./layeredSearch_find_transcripts.ts";
import { addFilesMentionedInTranscripts } from "./layeredSearch_mentioned_files.ts";
import { listMergedWorktreeFolders, listRepoWorktreeFolders } from "./layeredSearch_path_checks.ts";

export function getRepoFolderOfProject(projectFolder: Path): Path {
    return new Path(execFileSync("git", ["-C", projectFolder.toString(), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
}

export function listLayeredSearchProjectFiles(projectFolder: Path, repoFolder: Path, jsonlsFolders: Path[], isOutsideProjectIncluded: boolean, reportProgress: ProgressSink): { projectFiles: ProjectFile[]; transcriptsToParse: Path[] } {
    const worktreeFolders = listRepoWorktreeFolders(repoFolder);
    const mergedWorktreeFolders = listMergedWorktreeFolders(repoFolder);
    const diskFiles = listProjectFilePaths(projectFolder);
    const gitFiles = listGitTouchedFilePaths(repoFolder, projectFolder, isOutsideProjectIncluded);
    const relativeFiles = mergeFilePathsWithoutDuplicates(diskFiles, gitFiles);
    const files = convertToAbsoluteFilePaths(relativeFiles, projectFolder);
    const candidateTranscripts = findCandidateTranscripts(relativeFiles, jsonlsFolders, reportProgress);
    // const transcriptsToParse = filterTranscriptsByCwd(candidateTranscripts, jsonlsFolders, projectFolder, worktreeFolders);
    const transcriptsToParse = filterTranscriptsByCwdOrFilePath(candidateTranscripts, jsonlsFolders, projectFolder, worktreeFolders);
    // const allFileTexts = addFilesMentionedInTranscripts(files, transcriptsToParse, { repoFolder, projectFolder, isOutsideProjectIncluded }, worktreeFolders, mergedWorktreeFolders);
    const allFileTexts = removeFolderPathsFromFilePaths(addFilesMentionedInTranscripts(files, transcriptsToParse, { repoFolder, projectFolder, isOutsideProjectIncluded }, worktreeFolders, mergedWorktreeFolders));
    const projectFiles: ProjectFile[] = [];
    for (const fileText of allFileTexts) {
        const file = new Path(fileText);
        projectFiles.push({ file, transcriptFile: file });
    }
    return { projectFiles, transcriptsToParse };
}
