// Builds the inverse repo of every file of a project, reading the transcripts one time for all files.

import { existsSync, mkdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { listCurrentFileState } from "../src/layer1_disk_walk.ts";
import type { ProgressSink } from "../src/parse/loadTranscript.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { StateConfidence, listKnownStatesForFile } from "./engineV3_file_known_states.ts";
import { buildInverseRepoByEventKind } from "./engineV3_inverse_repo.ts";
import { loadJSONLLinesNamingFiles } from "./engineV3_jsonl_lines_naming_files.ts";
import { getAllEventsForFileFromLines, sortEventsNewestToOldest } from "./engineV3_replay_reverse_events.ts";

export type FileInverseRepoResult = { file: Path; repoFolder: Path; eventCount: number; stateCount: number; commitCount: number; unknownStateCount: number };

export type InverseReposSettings = { projectFolder: Path; jsonlsFolder: Path; fileHistoryFolder: Path; storeFolder: Path };

const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder>";

function getRelativePathInProject(projectFolder: Path, file: Path): string {
    const relativePath = relative(projectFolder.toString(), file.toString());
    if (relativePath.split(sep)[0] === "..") {
        throw new Error(`getRelativePathInProject: ${file.toString()} is outside the project folder ${projectFolder.toString()}`);
    }
    return relativePath;
}

export function getInverseRepoFolderForFile(storeFolder: Path, projectFolder: Path, file: Path): Path {
    return new Path(join(storeFolder.toString(), `${getRelativePathInProject(projectFolder, file)}.git`));
}

// file is the path on disk now; transcriptFile is the path the session logs use for it.
export type ProjectFile = { file: Path; transcriptFile: Path };

export function buildInverseReposForFiles(projectFolder: Path, projectFiles: ProjectFile[], jsonlsFolders: Path[], snapshotFolders: Path[], storeFolder: Path, diskNowInstant: Date, reportProgress: ProgressSink): FileInverseRepoResult[] {
    const repoFolders: Path[] = [];
    for (const { file } of projectFiles) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
        if (existsSync(repoFolder.toString())) {
            throw new Error(`buildInverseReposForFiles: the repo folder already exists: ${repoFolder.toString()}`);
        }
        repoFolders.push(repoFolder);
    }
    const linesByFileKey = loadJSONLLinesNamingFiles(projectFiles.map((projectFile) => projectFile.transcriptFile), jsonlsFolders);
    const results: FileInverseRepoResult[] = [];
    for (const [index, { file, transcriptFile }] of projectFiles.entries()) {
        const repoFolder = repoFolders[index]!;
        const events = sortEventsNewestToOldest(getAllEventsForFileFromLines(file, transcriptFile, linesByFileKey.get(transcriptFile.toString())!, snapshotFolders));
        const states = listKnownStatesForFile(events);
        mkdirSync(repoFolder.toString(), { recursive: true });
        buildInverseRepoByEventKind(repoFolder, basename(file.toString()), states, diskNowInstant);
        const unknownStateCount = states.filter((state) => state.confidence === StateConfidence.Unknown).length;
        const result = { file, repoFolder, eventCount: events.length, stateCount: states.length, commitCount: states.length - unknownStateCount, unknownStateCount };
        results.push(result);
        const label = `${getRelativePathInProject(projectFolder, file)}  events ${result.eventCount}  commits ${result.commitCount}  unknown ${result.unknownStateCount}`;
        reportProgress({ kind: DocumentResponseKind.progress, label, current: index + 1, total: projectFiles.length });
    }
    return results;
}

function readRequiredFolderFlag(argumentList: string[], flag: string): { folder: Path; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    return { folder: new Path(value), rest };
}

export function readInverseReposSettingsFromArguments(argumentList: string[]): InverseReposSettings {
    const projectFlag = readRequiredFolderFlag(argumentList, "--project");
    const jsonlsFlag = readRequiredFolderFlag(projectFlag.rest, "--jsonls");
    const fileHistoryFlag = readRequiredFolderFlag(jsonlsFlag.rest, "--file-history");
    const storeFlag = readRequiredFolderFlag(fileHistoryFlag.rest, "--store");
    return { projectFolder: projectFlag.folder, jsonlsFolder: jsonlsFlag.folder, fileHistoryFolder: fileHistoryFlag.folder, storeFolder: storeFlag.folder };
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
    const settings = readInverseReposSettingsFromArguments(process.argv.slice(2));
    const startMilliseconds = Date.now();
    const files = listCurrentFileState(settings.projectFolder).map((fileState) => new Path(join(settings.projectFolder.toString(), fileState.relativePath.toString())));
    const projectFiles = files.map((file) => ({ file, transcriptFile: file }));
    const results = buildInverseReposForFiles(settings.projectFolder, projectFiles, [settings.jsonlsFolder], [settings.fileHistoryFolder], settings.storeFolder, new Date(), (event) => {
        console.log(`${event.current}/${event.total}  ${event.label}`);
    });
    const commitTotal = results.reduce((sum, result) => sum + result.commitCount, 0);
    const seconds = ((Date.now() - startMilliseconds) / 1000).toFixed(1);
    console.log(`done: ${results.length} files, ${commitTotal} commits, ${seconds}s`);
}
