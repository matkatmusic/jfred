// S4a: read every project file at a Commit Mode mark from the inverse repos: it has a text, it is absent, or it is unknown.

import { basename, relative, sep } from "node:path";

import { listInverseCommits, type InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { listProjectFileStatesAtInstant, selectInverseCommitAtInstant } from "../engineV3/engineV3_inverse_repo_read.ts";
import { getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { Path } from "./structures/domain.ts";

export type NotProvenFile = { relativePath: string; bytesFromInstant: Date | undefined; firstScriptInstant: Date };
// texts and absentPaths hold project-relative paths with `/`. A file with no commit at the mark is in neither.
export type ReaderFilesAtMark = { texts: Map<string, string>; absentPaths: Set<string>; notProven: NotProvenFile[] };

enum MarkState {
  Text = "text",
  Absent = "absent",
  Unknown = "unknown",
}

const NOT_PROVEN_HEADER = "Not proven: a recorded script was not replayed for these files. The bytes are the nearest older known bytes.";

function getRelativePathWithSlashes(projectFolder: Path, file: Path): string {
  return relative(projectFolder.toString(), file.toString()).split(sep).join("/");
}

export function readProjectFilesAtMark(projectFolder: Path, storeFolder: Path, projectFiles: ProjectFile[], markInstant: Date): ReaderFilesAtMark {
  const texts = new Map<string, string>();
  const absentPaths = new Set<string>();
  const files = projectFiles.map((projectFile) => projectFile.file);
  const fileStates = listProjectFileStatesAtInstant(storeFolder, projectFolder, files, markInstant);
  for (const { file, commit } of fileStates) {
    const relativePath = getRelativePathWithSlashes(projectFolder, file);
    if (commit !== undefined) {
      if (commit.isFileAbsent) {
        absentPaths.add(relativePath);
      } else {
        texts.set(relativePath, commit.text!);
      }
    }
  }
  return { texts, absentPaths, notProven: [] };
}

export function formatNotProvenSection(notProven: NotProvenFile[]): string {
  if (notProven.length === 0) {
    return "";
  }
  const lines = notProven.map((notProvenFile) => {
    const bytesFromText = notProvenFile.bytesFromInstant === undefined ? "none" : notProvenFile.bytesFromInstant.toISOString();
    return `- ${notProvenFile.relativePath} (bytes from ${bytesFromText}, script at ${notProvenFile.firstScriptInstant.toISOString()})`;
  });
  return `\n\n${NOT_PROVEN_HEADER}\n${lines.join("\n")}`;
}

function getMarkState(relativePath: string, markTexts: ReadonlyMap<string, string>, markAbsentPaths: ReadonlySet<string>): MarkState {
  if (markTexts.has(relativePath)) {
    return MarkState.Text;
  }
  if (markAbsentPaths.has(relativePath)) {
    return MarkState.Absent;
  }
  return MarkState.Unknown;
}

function isLaterCommitAChange(laterCommit: InverseCommit, markState: MarkState, markText: string | undefined): boolean {
  if (laterCommit.isFileAbsent) {
    return markState === MarkState.Text;
  }
  if (markState === MarkState.Text) {
    return laterCommit.text !== markText;
  }
  return true;
}

export function findNextChangingInstantInRepos(projectFolder: Path, storeFolder: Path, projectFiles: ProjectFile[], markInstant: Date, markTexts: ReadonlyMap<string, string>, markAbsentPaths: ReadonlySet<string>): Date | undefined {
  let nextChangingInstant: Date | undefined;
  for (const projectFile of projectFiles) {
    const relativePath = getRelativePathWithSlashes(projectFolder, projectFile.file);
    const markState = getMarkState(relativePath, markTexts, markAbsentPaths);
    const markText = markTexts.get(relativePath);
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
    // listInverseCommits returns the newest first, so the later commits are walked from the end.
    // const commits = listInverseCommits(repoFolder, basename(projectFile.file.toString())).reverse();
    // for (const commit of commits) {
    //   if (commit.instant !== undefined) {
    //     if (commit.instant.getTime() > markInstant.getTime()) {
    //       if (isLaterCommitAChange(commit, markState, markText)) {
    //         if (nextChangingInstant === undefined) {
    //           nextChangingInstant = commit.instant;
    //         } else {
    //           if (commit.instant.getTime() < nextChangingInstant.getTime()) {
    //             nextChangingInstant = commit.instant;
    //           }
    //         }
    //         break;
    //       }
    //     }
    //   }
    // }
    const commits = listInverseCommits(repoFolder, basename(projectFile.file.toString()));
    const laterInstantTimes = new Set<number>();
    for (const commit of commits) {
      if (commit.instant !== undefined) {
        if (commit.instant.getTime() > markInstant.getTime()) {
          laterInstantTimes.add(commit.instant.getTime());
        }
      }
    }
    const ascendingLaterInstantTimes = [...laterInstantTimes].sort((leftTime, rightTime) => leftTime - rightTime);
    for (const laterInstantTime of ascendingLaterInstantTimes) {
      const laterInstant = new Date(laterInstantTime);
      const chosenCommit = selectInverseCommitAtInstant(commits, laterInstant);
      if (chosenCommit !== undefined) {
        if (isLaterCommitAChange(chosenCommit, markState, markText)) {
          if (nextChangingInstant === undefined) {
            nextChangingInstant = laterInstant;
          } else {
            if (laterInstantTime < nextChangingInstant.getTime()) {
              nextChangingInstant = laterInstant;
            }
          }
          break;
        }
      }
    }
  }
  return nextChangingInstant;
}
