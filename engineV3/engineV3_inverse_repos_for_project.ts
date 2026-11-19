// Builds the inverse repo of every file of a project, reading the transcripts one time for all files.

import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
// import { basename, join, relative, sep } from "node:path";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
// import { Path } from "../src/structures/domain.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { listCurrentFileState } from "../src/layer1_disk_walk.ts";
import type { ProgressSink } from "../src/parse/loadTranscript.ts";
import { extractCommaListFlag, extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
// import { InverseRepoMode } from "../src/structures/vocabulary.ts";
import { InverseRepoMode, OtherFilesPolicy } from "../src/structures/vocabulary.ts";
import { StateConfidence, StateMoment, createProvenState, getTextJustBeforeInstant, listKnownStatesForFile, type FileKnownState } from "./engineV3_file_known_states.ts";
import { buildInverseRepoByEventKind, createInverseRepo, listInverseCommits } from "./engineV3_inverse_repo.ts";
import { createFileStep } from "./engineV3_file_step.ts";
// import { runStepCommands } from "./engineV3_step_cli.ts";
import { runStepCommands, type StepCliSession } from "./engineV3_step_cli.ts";
import { stepUntilInstantIsSpanned } from "./engineV3_step_start_at.ts";
import { walkAllFilesInStepMode } from "./engineV3_step_all.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import type { JSONLLine } from "./engineV3.ts";
import { loadJSONLLinesNamingFiles } from "./engineV3_jsonl_lines_naming_files.ts";
import { FileEventType, createEvent, getAllEventsForFileFromLines, sortEventsNewestToOldest, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { readDiskText } from "./engineV3_replay_reverse.ts";
import { addLinesNamingWrittenScripts } from "./engineV3_jsonl_lines_naming_scripts.ts";
import { getLineSourceIndexFile, listLinesOfFileFromIndex, readLineSourceIndex, type LineSourceIndex } from "./engineV3_jsonl_lines_source_index.ts";
// import { assertStoreHasNoFullBuildRepos } from "./engineV3_step_store_guard.ts";
import { assertStoreHasNoFullBuildRepos, resetStoreFolder } from "./engineV3_step_store_guard.ts";
// import { applyEarliestBoundaryToEvents, readFileTextAtBoundary, type EarliestBoundary } from "./engineV3_earliest_boundary.ts";
import { applyEarliestBoundaryToEvents, readEarliestBoundary, readFileTextAtBoundary, type EarliestBoundary } from "./engineV3_earliest_boundary.ts";
import { buildReplayGapsSidecar, isReplayGapsSidecarPresent, writeReplayGapsSidecar } from "./engineV3_script_replay_gaps.ts";
import type { ProjectCacheJson } from "./tui/engineV3_tui_project_cache.ts";

export type FileInverseRepoResult = { file: Path; repoFolder: Path; eventCount: number; stateCount: number; commitCount: number; unknownStateCount: number; wasReused: boolean };

// The inputs a repo was built from: the bytes on disk, the log path of the file, and the log files with size and modified time.
// type InverseRepoStampInputs = { diskBytesHash: string; diskModifiedMilliseconds: number | null; transcriptFile: string; logFilesHash: string; formatVersion: number };
// boundaryCommit is set only when an earliest boundary is given, so the stamps of older stores stay equal.
type InverseRepoStampInputs = { diskBytesHash: string; diskModifiedMilliseconds: number | null; transcriptFile: string; logFilesHash: string; formatVersion: number; boundaryCommit?: string };
type InverseRepoStamp = { inputs: InverseRepoStampInputs; eventCount: number; stateCount: number; commitCount: number; unknownStateCount: number; mode?: InverseRepoMode };

export const INVERSE_REPO_FORMAT_VERSION = 4;
export const STAMP_FILE_NAME = "jfred-stamp.json";
const ABSENT_DISK_BYTES_HASH = "absent";

// export type InverseReposSettings = { projectFolder: Path; jsonlsFolder: Path; fileHistoryFolder: Path; storeFolder: Path };
export type InverseReposSettings = { projectFolder: Path; jsonlsFolders: Path[]; fileHistoryFolders: Path[]; storeFolder: Path };

// const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder>";
// const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder> [--step <project-relative file> [--from-now]]";
// const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder> [--step <project-relative file> [--from-now]]  (in step mode the commands are f, b, r and q)";
// const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder> [--step <project-relative file> [--from-now]] [--step-all --results <file>]  (in step mode the commands are f, b, r and q)";
// const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder> --file-history <folder> --store <folder> [--resetStore] [--step <project-relative file> [--from-now]] [--step-all --results <file>]  (in step mode the commands are f, b, r and q)";
// const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> [--resetStore] [--step <project-relative file> [--from-now]] [--step-all --results <file>]  (in step mode the commands are f, b, r and q; a folder name with a comma is not supported)";
const USAGE = "usage: node engineV3_inverse_repos_for_project.ts --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> [--resetStore] [--step <project-relative file> [--from-now] [--startAt <ISO instant> [--pass-stops]] [--repo <folder> --commit <commit>] [--no-walk-other-files]] [--step-all --results <file>]  (in step mode the commands are f, b, r and q; a folder name with a comma is not supported)";

export const OUTSIDE_PROJECT_PREFIX = ".outside-project/";

export function getRelativePathInProject(projectFolder: Path, file: Path): string {
    const relativePath = relative(projectFolder.toString(), file.toString());
    if (relativePath.split(sep)[0] === "..") {
        // throw new Error(`getRelativePathInProject: ${file.toString()} is outside the project folder ${projectFolder.toString()}`);
        // return ".outside-project/" + file.toString().replace("/", "");
        return OUTSIDE_PROJECT_PREFIX + file.toString().replace("/", "");
    }
    return relativePath;
}

// The reverse of getRelativePathInProject.
export function getAbsolutePathFromProjectRelativePath(projectFolder: Path, relativePath: string): Path {
    if (relativePath.startsWith(OUTSIDE_PROJECT_PREFIX)) {
        return new Path("/" + relativePath.slice(OUTSIDE_PROJECT_PREFIX.length));
    }
    return new Path(join(projectFolder.toString(), relativePath));
}

// The names the progress events use for the files, so the bar rows are found by the same names.
export function listBarRowNamesOfProjectFiles(projectFolder: Path, files: Path[]): string[] {
    return files.map((file) => getRelativePathInProject(projectFolder, file).split(sep).join("/"));
}

export function getInverseRepoFolderForFile(storeFolder: Path, projectFolder: Path, file: Path): Path {
    return new Path(join(storeFolder.toString(), `${getRelativePathInProject(projectFolder, file)}.git`));
}

// file is the path on disk now; transcriptFile is the path the session logs use for it.
export type ProjectFile = { file: Path; transcriptFile: Path };

function findProjectFileIndexByTranscriptFile(projectFiles: ProjectFile[], transcriptFile: Path): number | undefined {
    for (const [index, projectFile] of projectFiles.entries()) {
        if (projectFile.transcriptFile.equals(transcriptFile)) {
            return index;
        }
    }
    return undefined;
}

// A file born by a move or a copy takes the text its source file had just before that event, so the source states come first.
export function listStatesOfProjectFile(fileIndex: number, projectFiles: ProjectFile[], getEvents: (fileIndex: number) => FileEvent[], statesByFile: (FileKnownState[] | undefined)[], fileIndexesBeingComputed: Set<number>): FileKnownState[] {
    const computedStates = statesByFile[fileIndex];
    if (computedStates !== undefined) {
        return computedStates;
    }
    fileIndexesBeingComputed.add(fileIndex);
    const events = getEvents(fileIndex);
    const oldestEvent = events[events.length - 1];
    if (oldestEvent !== undefined) {
        if (oldestEvent.moveOrCopySourceFile !== undefined) {
            if (oldestEvent.instant === undefined) {
                throw new Error(`listStatesOfProjectFile: the oldest event of ${projectFiles[fileIndex]!.file.toString()} has a move or copy source but no instant`);
            }
            const sourceFileIndex = findProjectFileIndexByTranscriptFile(projectFiles, oldestEvent.moveOrCopySourceFile);
            if (sourceFileIndex !== undefined) {
                if (fileIndexesBeingComputed.has(sourceFileIndex)) {
                    throw new Error(`listStatesOfProjectFile: ${projectFiles[fileIndex]!.file.toString()} and ${projectFiles[sourceFileIndex]!.file.toString()} are each born from the other`);
                }
                const sourceStates = listStatesOfProjectFile(sourceFileIndex, projectFiles, getEvents, statesByFile, fileIndexesBeingComputed);
                const bornText = getTextJustBeforeInstant(sourceStates, oldestEvent.instant);
                if (bornText !== undefined) {
                    oldestEvent.bytes = bornText;
                }
            }
        }
    }
    const states = listKnownStatesForFile(events);
    fileIndexesBeingComputed.delete(fileIndex);
    statesByFile[fileIndex] = states;
    return states;
}

function hashText(text: string | Buffer): string {
    return createHash("sha256").update(text).digest("hex");
}

function getDiskBytesHash(file: Path): string {
    if (!existsSync(file.toString())) {
        return ABSENT_DISK_BYTES_HASH;
    }
    return hashText(readFileSync(file.toString()));
}

function getDiskModifiedInstant(file: Path): Date | undefined {
    if (!existsSync(file.toString())) {
        return undefined;
    }
    return statSync(file.toString()).mtime;
}

// Log files only grow when new lines arrive, so their size and modified time change with every new line of the project.
export function getLogFilesHash(jsonlsFolders: Path[]): string {
    const logFileLines = listTranscriptFiles(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString())).map((logFile) => {
        const logFileStats = statSync(logFile.toString());
        return `${logFile.toString()} ${logFileStats.size} ${logFileStats.mtimeMs}`;
    });
    return hashText(logFileLines.sort().join("\n"));
}

function readInverseRepoStamp(repoFolder: Path): InverseRepoStamp | undefined {
    const stampPath = join(repoFolder.toString(), STAMP_FILE_NAME);
    if (!existsSync(stampPath)) {
        return undefined;
    }
    return JSON.parse(readFileSync(stampPath, "utf8")) as InverseRepoStamp;
}

function writeInverseRepoStamp(repoFolder: Path, stamp: InverseRepoStamp): void {
    writeFileSync(join(repoFolder.toString(), STAMP_FILE_NAME), JSON.stringify(stamp));
}

// function buildStampInputs(file: Path, transcriptFile: Path, logFilesHash: string): InverseRepoStampInputs {
function buildStampInputs(file: Path, transcriptFile: Path, logFilesHash: string, earliestBoundary?: EarliestBoundary): InverseRepoStampInputs {
    const diskModifiedInstant = getDiskModifiedInstant(file);
    const inputs: InverseRepoStampInputs = { diskBytesHash: getDiskBytesHash(file), diskModifiedMilliseconds: diskModifiedInstant === undefined ? null : diskModifiedInstant.getTime(), transcriptFile: transcriptFile.toString(), logFilesHash, formatVersion: INVERSE_REPO_FORMAT_VERSION };
    if (earliestBoundary !== undefined) {
        inputs.boundaryCommit = earliestBoundary.commit.toString();
    }
    return inputs;
}

function isStampBuiltFromInputs(stamp: InverseRepoStamp, inputs: InverseRepoStampInputs): boolean {
    if (stamp.inputs.diskBytesHash === inputs.diskBytesHash) {
        if (stamp.inputs.diskModifiedMilliseconds === inputs.diskModifiedMilliseconds) {
            if (stamp.inputs.transcriptFile === inputs.transcriptFile) {
                if (stamp.inputs.logFilesHash === inputs.logFilesHash) {
                    if (stamp.inputs.formatVersion === inputs.formatVersion) {
                        return stamp.inputs.boundaryCommit === inputs.boundaryCommit;
                    }
                }
            }
        }
    }
    return false;
}

// Script indirection is on here: this is the per-file repo path only.
// export function createProjectEventsLoader(projectFiles: ProjectFile[], jsonlsFolders: Path[], snapshotFolders: Path[]): (fileIndex: number) => FileEvent[] {
export function createProjectEventsLoader(projectFiles: ProjectFile[], jsonlsFolders: Path[], snapshotFolders: Path[], earliestBoundary?: EarliestBoundary, onLinesLoaded?: (linesByFileKey: Map<string, JSONLLine[]>) => void): (fileIndex: number) => FileEvent[] {
    let linesByFileKey: Map<string, JSONLLine[]> | undefined;
    const eventsByFile: (FileEvent[] | undefined)[] = projectFiles.map(() => undefined);
    return (fileIndex: number): FileEvent[] => {
        const computedEvents = eventsByFile[fileIndex];
        if (computedEvents !== undefined) {
            return computedEvents;
        }
        if (linesByFileKey === undefined) {
            const transcriptFiles = projectFiles.map((projectFile) => projectFile.transcriptFile);
            linesByFileKey = loadJSONLLinesNamingFiles(transcriptFiles, jsonlsFolders);
            addLinesNamingWrittenScripts(linesByFileKey, transcriptFiles, jsonlsFolders);
            if (onLinesLoaded !== undefined) {
                onLinesLoaded(linesByFileKey);
            }
        }
        const { file, transcriptFile } = projectFiles[fileIndex]!;
        // const events = sortEventsNewestToOldest(getAllEventsForFileFromLines(file, transcriptFile, linesByFileKey.get(transcriptFile.toString())!, snapshotFolders, true));
        let events = sortEventsNewestToOldest(getAllEventsForFileFromLines(file, transcriptFile, linesByFileKey.get(transcriptFile.toString())!, snapshotFolders, true));
        if (earliestBoundary !== undefined) {
            events = applyEarliestBoundaryToEvents(events, earliestBoundary, readFileTextAtBoundary(earliestBoundary, file));
        }
        eventsByFile[fileIndex] = events;
        return events;
    };
}
// Like createProjectEventsLoader, but each file reads only the log lines that name that file: a step child needs one file (and the file it was moved or copied from), not all of them.
export function createSingleFileEventsLoader(projectFiles: ProjectFile[], jsonlsFolders: Path[], snapshotFolders: Path[], earliestBoundary?: EarliestBoundary, lineSourceIndex?: LineSourceIndex): (fileIndex: number) => FileEvent[] {
    const eventsByFile: (FileEvent[] | undefined)[] = projectFiles.map(() => undefined);
    return (fileIndex: number): FileEvent[] => {
        const computedEvents = eventsByFile[fileIndex];
        if (computedEvents !== undefined) {
            return computedEvents;
        }
        const { file, transcriptFile } = projectFiles[fileIndex]!;
        let linesByFileKey: Map<string, JSONLLine[]>;
        if (lineSourceIndex === undefined) {
            linesByFileKey = loadJSONLLinesNamingFiles([transcriptFile], jsonlsFolders);
            addLinesNamingWrittenScripts(linesByFileKey, [transcriptFile], jsonlsFolders);
        } else {
            linesByFileKey = new Map([[transcriptFile.toString(), listLinesOfFileFromIndex(lineSourceIndex, transcriptFile.toString())]]);
        }
        let events = sortEventsNewestToOldest(getAllEventsForFileFromLines(file, transcriptFile, linesByFileKey.get(transcriptFile.toString())!, snapshotFolders, true));
        if (earliestBoundary !== undefined) {
            events = applyEarliestBoundaryToEvents(events, earliestBoundary, readFileTextAtBoundary(earliestBoundary, file));
        }
        eventsByFile[fileIndex] = events;
        return events;
    };
}

export function listKnownStatesForProjectFiles(projectFiles: ProjectFile[], jsonlsFolders: Path[], snapshotFolders: Path[]): FileKnownState[][] {
    const getEvents = createProjectEventsLoader(projectFiles, jsonlsFolders, snapshotFolders);
    const statesByFile: (FileKnownState[] | undefined)[] = projectFiles.map(() => undefined);
    const fileIndexesBeingComputed = new Set<number>();
    return projectFiles.map((_projectFile, fileIndex) => listStatesOfProjectFile(fileIndex, projectFiles, getEvents, statesByFile, fileIndexesBeingComputed));
}

export function buildInverseReposForFiles(projectFolder: Path, projectFiles: ProjectFile[], jsonlsFolders: Path[], snapshotFolders: Path[], storeFolder: Path, diskNowInstant: Date, reportProgress: ProgressSink): FileInverseRepoResult[] {
    const repoFolders: Path[] = [];
    for (const { file } of projectFiles) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
        // The repo folder of a stale repo is removed and built again, so an existing folder no longer throws.
        // if (existsSync(repoFolder.toString())) {
        //     throw new Error(`buildInverseReposForFiles: the repo folder already exists: ${repoFolder.toString()}`);
        // }
        repoFolders.push(repoFolder);
    }
    const logFilesHash = getLogFilesHash(jsonlsFolders);
    const getEvents = createProjectEventsLoader(projectFiles, jsonlsFolders, snapshotFolders);
    const statesByFile: (FileKnownState[] | undefined)[] = projectFiles.map(() => undefined);
    const fileIndexesBeingComputed = new Set<number>();
    const results: FileInverseRepoResult[] = [];
    for (const [index, { file, transcriptFile }] of projectFiles.entries()) {
        const repoFolder = repoFolders[index]!;
        const diskModifiedInstant = getDiskModifiedInstant(file);
        // const inputs: InverseRepoStampInputs = { diskBytesHash: getDiskBytesHash(file), diskModifiedMilliseconds: diskModifiedInstant === undefined ? null : diskModifiedInstant.getTime(), transcriptFile: transcriptFile.toString(), logFilesHash, formatVersion: INVERSE_REPO_FORMAT_VERSION };
        const inputs = buildStampInputs(file, transcriptFile, logFilesHash);
        const existingStamp = readInverseRepoStamp(repoFolder);
        const relativeFile = getRelativePathInProject(projectFolder, file);
        const projectRelativeFile = relativeFile.split(sep).join("/");
        let result: FileInverseRepoResult | undefined;
        if (existingStamp !== undefined) {
            if (existingStamp.mode === undefined) {
                if (isStampBuiltFromInputs(existingStamp, inputs)) {
                    if (isReplayGapsSidecarPresent(repoFolder)) {
                        result = { file, repoFolder, eventCount: existingStamp.eventCount, stateCount: existingStamp.stateCount, commitCount: existingStamp.commitCount, unknownStateCount: existingStamp.unknownStateCount, wasReused: true };
                    }
                }
            }
        }
        if (result === undefined) {
            reportProgress({ kind: DocumentResponseKind.progress, label: projectRelativeFile, buildingFile: projectRelativeFile });
            rmSync(repoFolder.toString(), { recursive: true, force: true });
            const events = getEvents(index);
            const states = listStatesOfProjectFile(index, projectFiles, getEvents, statesByFile, fileIndexesBeingComputed);
            mkdirSync(repoFolder.toString(), { recursive: true });
            const unknownStateCount = states.filter((state) => state.confidence === StateConfidence.Unknown).length;
            // The states are computed before the repo is written, so the commit count is known before the first commit.
            const commitCount = states.length - unknownStateCount;
            let fileStepsDone = 0;
            const reportStepDone = (): void => {
                fileStepsDone += 1;
                reportProgress({ kind: DocumentResponseKind.progress, label: relativeFile, file: projectRelativeFile, fileStepsDone, fileStepsTotal: commitCount });
            };
            const diskNowState = states[0]!;
            const statesWithDiskNowInstant = [{ ...diskNowState, event: { ...diskNowState.event, instant: diskModifiedInstant } }, ...states.slice(1)];
            buildInverseRepoByEventKind(repoFolder, basename(file.toString()), statesWithDiskNowInstant, diskNowInstant, reportStepDone);
            writeReplayGapsSidecar(repoFolder, buildReplayGapsSidecar(states));
            result = { file, repoFolder, eventCount: events.length, stateCount: states.length, commitCount, unknownStateCount, wasReused: false };
            writeInverseRepoStamp(repoFolder, { inputs, eventCount: result.eventCount, stateCount: result.stateCount, commitCount: result.commitCount, unknownStateCount });
        }
        results.push(result);
        const label = `${relativeFile}  events ${result.eventCount}  commits ${result.commitCount}  unknown ${result.unknownStateCount}`;
        reportProgress({ kind: DocumentResponseKind.progress, label, current: index + 1, total: projectFiles.length, file: projectRelativeFile, fileStepsDone: result.commitCount, fileStepsTotal: result.commitCount });
    }
    return results;
}

// export function listProjectFilesWithStaleInverseRepos(storeFolder: Path, projectFolder: Path, projectFiles: ProjectFile[], jsonlsFolders: Path[]): ProjectFile[] {
export function listProjectFilesWithStaleInverseRepos(storeFolder: Path, projectFolder: Path, projectFiles: ProjectFile[], jsonlsFolders: Path[], earliestBoundary?: EarliestBoundary): ProjectFile[] {
    const logFilesHash = getLogFilesHash(jsonlsFolders);
    const staleProjectFiles: ProjectFile[] = [];
    for (const projectFile of projectFiles) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, projectFile.file);
        if (existsSync(repoFolder.toString())) {
            const stamp = readInverseRepoStamp(repoFolder);
            if (stamp === undefined) {
                staleProjectFiles.push(projectFile);
            } else {
                // if (!isStampBuiltFromInputs(stamp, buildStampInputs(projectFile.file, projectFile.transcriptFile, logFilesHash))) {
                if (!isStampBuiltFromInputs(stamp, buildStampInputs(projectFile.file, projectFile.transcriptFile, logFilesHash, earliestBoundary))) {
                    staleProjectFiles.push(projectFile);
                }
            }
        }
    }
    return staleProjectFiles;
}

export function isInverseRepoOnDemand(repoFolder: Path): boolean {
    const stamp = readInverseRepoStamp(repoFolder);
    if (stamp === undefined) {
        return false;
    }
    return stamp.mode === InverseRepoMode.OnDemand;
}

// export function buildOnDemandInverseReposForFiles(projectFolder: Path, projectFiles: ProjectFile[], jsonlsFolders: Path[], storeFolder: Path, diskNowInstant: Date, reportProgress: ProgressSink): FileInverseRepoResult[] {
export function buildOnDemandInverseReposForFiles(projectFolder: Path, projectFiles: ProjectFile[], jsonlsFolders: Path[], storeFolder: Path, diskNowInstant: Date, reportProgress: ProgressSink, earliestBoundary?: EarliestBoundary): FileInverseRepoResult[] {
    const logFilesHash = getLogFilesHash(jsonlsFolders);
    const results: FileInverseRepoResult[] = [];
    for (const [index, { file, transcriptFile }] of projectFiles.entries()) {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
        // const inputs = buildStampInputs(file, transcriptFile, logFilesHash);
        const inputs = buildStampInputs(file, transcriptFile, logFilesHash, earliestBoundary);
        const existingStamp = readInverseRepoStamp(repoFolder);
        const relativeFile = getRelativePathInProject(projectFolder, file);
        const projectRelativeFile = relativeFile.split(sep).join("/");
        let result: FileInverseRepoResult | undefined;
        if (existingStamp !== undefined) {
            if (existingStamp.mode === InverseRepoMode.OnDemand) {
                if (isStampBuiltFromInputs(existingStamp, inputs)) {
                    result = { file, repoFolder, eventCount: existingStamp.eventCount, stateCount: existingStamp.stateCount, commitCount: existingStamp.commitCount, unknownStateCount: existingStamp.unknownStateCount, wasReused: true };
                }
            }
        }
        if (result === undefined) {
            rmSync(repoFolder.toString(), { recursive: true, force: true });
            mkdirSync(repoFolder.toString(), { recursive: true });
            const diskNowEvent = createEvent(FileEventType.DiskNow, getDiskModifiedInstant(file), undefined, { bytes: readDiskText(file) });
            const diskNowState = createProvenState(diskNowEvent, StateMoment.AtEvent, diskNowEvent.bytes);
            createInverseRepo(repoFolder, basename(file.toString()), { state: diskNowState, position: 0 }, diskNowInstant);
            writeInverseRepoStamp(repoFolder, { inputs, eventCount: 0, stateCount: 1, commitCount: 1, unknownStateCount: 0, mode: InverseRepoMode.OnDemand });
            result = { file, repoFolder, eventCount: 0, stateCount: 1, commitCount: 1, unknownStateCount: 0, wasReused: false };
        }
        results.push(result);
        const label = `${relativeFile}  events ${result.eventCount}  commits ${result.commitCount}  unknown ${result.unknownStateCount}`;
        reportProgress({ kind: DocumentResponseKind.progress, label, current: index + 1, total: projectFiles.length, file: projectRelativeFile, fileStepsDone: result.commitCount, fileStepsTotal: result.commitCount });
    }
    return results;
}

function readRequiredFolderFlag(argumentList: string[], flag: string): { folder: Path; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    // return { folder: new Path(value), rest };
    return { folder: new Path(resolve(value)), rest };
}

function readRequiredFolderListFlag(argumentList: string[], flag: string): { folders: Path[]; rest: string[] } {
    const { values, rest } = extractCommaListFlag(argumentList, flag);
    if (values.length === 0) {
        throw new Error(USAGE);
    }
    return { folders: values.map((value) => new Path(value)), rest };
}

export function readInverseReposSettingsFromArguments(argumentList: string[]): InverseReposSettings {
    const projectFlag = readRequiredFolderFlag(argumentList, "--project");
    // const jsonlsFlag = readRequiredFolderFlag(projectFlag.rest, "--jsonls");
    const jsonlsFlag = readRequiredFolderListFlag(projectFlag.rest, "--jsonls");
    // const fileHistoryFlag = readRequiredFolderFlag(jsonlsFlag.rest, "--file-history");
    const fileHistoryFlag = readRequiredFolderListFlag(jsonlsFlag.rest, "--file-history");
    const storeFlag = readRequiredFolderFlag(fileHistoryFlag.rest, "--store");
    // return { projectFolder: projectFlag.folder, jsonlsFolder: jsonlsFlag.folder, fileHistoryFolder: fileHistoryFlag.folder, storeFolder: storeFlag.folder };
    return { projectFolder: projectFlag.folder, jsonlsFolders: jsonlsFlag.folders, fileHistoryFolders: fileHistoryFlag.folders, storeFolder: storeFlag.folder };
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
    const stepFlag = extractValueFlag(process.argv.slice(2), "--step");
    const isFromNow = stepFlag.rest.includes("--from-now");
    const isStepAll = stepFlag.rest.includes("--step-all");
    const resultsFlag = extractValueFlag(stepFlag.rest, "--results");
    const startAtFlag = extractValueFlag(resultsFlag.rest, "--startAt");
    const repoFlag = extractValueFlag(startAtFlag.rest, "--repo");
    const commitFlag = extractValueFlag(repoFlag.rest, "--commit");
    const projectCacheFlag = extractValueFlag(commitFlag.rest, "--project-cache");
    const isPassingStops = commitFlag.rest.includes("--pass-stops");
    const isNotWalkingOtherFiles = commitFlag.rest.includes("--no-walk-other-files");
    if (isNotWalkingOtherFiles) {
        if (stepFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    if (startAtFlag.value !== undefined) {
        if (stepFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    if (repoFlag.value !== undefined) {
        if (commitFlag.value === undefined) {
            throw new Error(USAGE);
        }
        if (stepFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    if (commitFlag.value !== undefined) {
        if (repoFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    if (isPassingStops) {
        if (startAtFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    let startAt: Date | undefined;
    if (startAtFlag.value !== undefined) {
        startAt = new Date(startAtFlag.value);
        if (Number.isNaN(startAt.getTime())) {
            throw new Error(USAGE);
        }
    }
    if (isStepAll) {
        if (startAtFlag.value !== undefined) {
            throw new Error(USAGE);
        }
        if (stepFlag.value !== undefined) {
            throw new Error(USAGE);
        }
        if (resultsFlag.value === undefined) {
            throw new Error(USAGE);
        }
        if (isFromNow) {
            throw new Error(USAGE);
        }
    }
    // const argumentsWithoutStepFlags = stepFlag.rest.filter((argument) => argument !== "--from-now");
    // const isResetStore = resultsFlag.rest.includes("--resetStore");
    const isResetStore = commitFlag.rest.includes("--resetStore");
    // const argumentsWithoutStepFlags = resultsFlag.rest.filter((argument) => argument !== "--from-now" && argument !== "--step-all");
    // const argumentsWithoutStepFlags = resultsFlag.rest.filter((argument) => argument !== "--from-now" && argument !== "--step-all" && argument !== "--resetStore");
    // const argumentsWithoutStepFlags = commitFlag.rest.filter((argument) => argument !== "--from-now" && argument !== "--step-all" && argument !== "--resetStore" && argument !== "--pass-stops");
    // const argumentsWithoutStepFlags = commitFlag.rest.filter((argument) => argument !== "--from-now" && argument !== "--step-all" && argument !== "--resetStore" && argument !== "--pass-stops" && argument !== "--no-walk-other-files");
    const argumentsWithoutStepFlags = projectCacheFlag.rest.filter((argument) => argument !== "--from-now" && argument !== "--step-all" && argument !== "--resetStore" && argument !== "--pass-stops" && argument !== "--no-walk-other-files");
    // const settings = readInverseReposSettingsFromArguments(process.argv.slice(2));
    const settings = readInverseReposSettingsFromArguments(argumentsWithoutStepFlags);
    if (isResetStore) {
        resetStoreFolder(settings.storeFolder);
    }
    const startMilliseconds = Date.now();
    // const files = listCurrentFileState(settings.projectFolder).map((fileState) => new Path(join(settings.projectFolder.toString(), fileState.relativePath.toString())));
    // const projectFiles = files.map((file) => ({ file, transcriptFile: file }));
    // const { listProjectFilesOnDiskAndInLogs } = await import("./engineV3_inverse_repos_project_files.ts");
    // const projectFiles = listProjectFilesOnDiskAndInLogs(settings.projectFolder, [settings.jsonlsFolder]);
    // The terminal UI passes its project cache, so a step child does not search every log again for the file list.
    let projectFiles: ProjectFile[];
    let transcriptsToParse: Path[];
    let lineSourceIndex: LineSourceIndex | undefined;
    if (projectCacheFlag.value === undefined) {
        const { listLayeredSearchProjectFiles, getRepoFolderOfProject } = await import("./layeredSearch/layeredSearch_project_files.ts");
        const repoFolder = getRepoFolderOfProject(settings.projectFolder);
        // The terminal bars sink is created after this call, so the progress callback does nothing.
        // const { projectFiles, transcriptsToParse } = listLayeredSearchProjectFiles(settings.projectFolder, repoFolder, [settings.jsonlsFolder], false, () => {});
        ({ projectFiles, transcriptsToParse } = listLayeredSearchProjectFiles(settings.projectFolder, repoFolder, settings.jsonlsFolders, false, () => {}));
    } else {
        // The cache module imports this module, so it cannot be imported here: this module is still running.
        const projectCacheJson = JSON.parse(readFileSync(resolve(projectCacheFlag.value), "utf8")) as Pick<ProjectCacheJson, "projectFiles" | "transcriptsToParse">;
        projectFiles = projectCacheJson.projectFiles.map((fileText) => ({ file: new Path(fileText), transcriptFile: new Path(fileText) }));
        transcriptsToParse = projectCacheJson.transcriptsToParse.map((transcriptText) => new Path(transcriptText));
        lineSourceIndex = readLineSourceIndex(getLineSourceIndexFile(new Path(resolve(projectCacheFlag.value))));
    }
    if (isStepAll) {
        // await walkAllFilesInStepMode({ projectFolder: settings.projectFolder, jsonlsFolder: settings.jsonlsFolder, fileHistoryFolder: settings.fileHistoryFolder, storeFolder: settings.storeFolder, projectFiles, transcriptsToParse, resultsFile: new Path(resultsFlag.value!) });
        await walkAllFilesInStepMode({ projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, projectFiles, transcriptsToParse, resultsFile: new Path(resultsFlag.value!) });
        process.exit(0);
    }
    if (stepFlag.value !== undefined) {
        const stepProjectFile = projectFiles.find((projectFile) => getRelativePathInProject(settings.projectFolder, projectFile.file).split(sep).join("/") === stepFlag.value);
        if (stepProjectFile === undefined) {
            throw new Error(`--step ${stepFlag.value}: no project file has this project-relative path`);
        }
        // const events = createProjectEventsLoader([stepProjectFile], transcriptsToParse, [settings.fileHistoryFolder])(0);
        let earliestBoundary: EarliestBoundary | undefined;
        if (repoFlag.value !== undefined) {
            earliestBoundary = readEarliestBoundary(new Path(repoFlag.value), new Uuid(commitFlag.value!));
        }
        // const getEvents = createProjectEventsLoader(projectFiles, transcriptsToParse, [settings.fileHistoryFolder]);
        // const getEvents = createProjectEventsLoader(projectFiles, transcriptsToParse, settings.fileHistoryFolders);
        // const getEvents = createProjectEventsLoader(projectFiles, transcriptsToParse, settings.fileHistoryFolders, earliestBoundary);
        const getEvents = createSingleFileEventsLoader(projectFiles, transcriptsToParse, settings.fileHistoryFolders, earliestBoundary, lineSourceIndex);
        const stepFileIndex = projectFiles.indexOf(stepProjectFile);
        const statesByFile: (FileKnownState[] | undefined)[] = projectFiles.map(() => undefined);
        listStatesOfProjectFile(stepFileIndex, projectFiles, getEvents, statesByFile, new Set<number>());
        const events = getEvents(stepFileIndex);
        const inverseRepoFolder = getInverseRepoFolderForFile(settings.storeFolder, settings.projectFolder, stepProjectFile.file);
        const fileName = basename(stepProjectFile.file.toString());
        if (isFromNow) {
            rmSync(inverseRepoFolder.toString(), { recursive: true, force: true });
        }
        assertStoreHasNoFullBuildRepos(settings.storeFolder, settings.projectFolder, [stepProjectFile]);
        // buildOnDemandInverseReposForFiles(settings.projectFolder, [stepProjectFile], transcriptsToParse, settings.storeFolder, new Date(), () => {});
        buildOnDemandInverseReposForFiles(settings.projectFolder, [stepProjectFile], transcriptsToParse, settings.storeFolder, new Date(), () => {}, earliestBoundary);
        const storedCommits = listInverseCommits(inverseRepoFolder, fileName, true);
        const step = createFileStep(events, storedCommits);
        let otherFilesPolicy = OtherFilesPolicy.WalkThem;
        if (isNotWalkingOtherFiles) {
            otherFilesPolicy = OtherFilesPolicy.RefuseIfUnfinished;
        }
        // Only the play child (--no-walk-other-files) installs the handler, so other step children keep Node's default exit on SIGTERM.
        const abortController = new AbortController();
        // process.once("SIGTERM", () => abortController.abort());
        if (isNotWalkingOtherFiles) {
            process.once("SIGTERM", () => abortController.abort());
        }
        const session: StepCliSession = { repoFolder: inverseRepoFolder, fileName, relativeFile: stepFlag.value, events, step, replay: { projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, transcriptsToParse, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, earliestBoundary, otherFilesPolicy, abortSignal: abortController.signal, stepProjectFile, replayFiles: undefined, walkedOtherFiles: undefined } };
        const tipCommit = storedCommits[storedCommits.length - 1]!;
        if (storedCommits.length > 1) {
            console.log(JSON.stringify({ resume: true, position: tipCommit.position, commit: tipCommit.commitHash.toString() }));
        }
        process.on("exit", (exitCode) => {
            if (exitCode !== 0) {
                const crashedEvent = events[step.nextEventIndex];
                const crashedSource = crashedEvent?.source;
                const crashedSourceText = crashedSource === undefined ? null : `${crashedSource.filePath}:${crashedSource.lineNumber}`;
                console.log(JSON.stringify({ crashedAt: { nextEventIndex: step.nextEventIndex, eventType: crashedEvent?.type ?? null, source: crashedSourceText } }));
            }
        });
        // await runStepCommands(createInterface({ input: process.stdin }), { repoFolder: inverseRepoFolder, fileName, relativeFile: stepFlag.value, events, step });
        // await runStepCommands(createInterface({ input: process.stdin }), { repoFolder: inverseRepoFolder, fileName, relativeFile: stepFlag.value, events, step, replay: { projectFolder: settings.projectFolder, jsonlsFolder: settings.jsonlsFolder, transcriptsToParse, fileHistoryFolder: settings.fileHistoryFolder, storeFolder: settings.storeFolder, stepProjectFile, replayFiles: undefined, walkedOtherFiles: undefined } });
        // await runStepCommands(createInterface({ input: process.stdin }), { repoFolder: inverseRepoFolder, fileName, relativeFile: stepFlag.value, events, step, replay: { projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, transcriptsToParse, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, stepProjectFile, replayFiles: undefined, walkedOtherFiles: undefined } });
        if (startAt !== undefined) {
            stepUntilInstantIsSpanned(session, startAt, isPassingStops);
        }
        await runStepCommands(createInterface({ input: process.stdin }), session);
        process.exit(0);
    }
    const files = projectFiles.map((projectFile) => projectFile.file);
    const { createTerminalBarsSink } = await import("./engineV3_inverse_repos_terminal_bars.ts");
    // const fileNames = files.map((file) => relative(settings.projectFolder.toString(), file.toString()));
    const fileNames = listBarRowNamesOfProjectFiles(settings.projectFolder, files);
    // const reportProgress = (event) => { console.log(`${event.current}/${event.total}  ${event.label}`); };
    const reportProgress = createTerminalBarsSink(process.stdout, fileNames);
    // const results = buildInverseReposForFiles(settings.projectFolder, projectFiles, [settings.jsonlsFolder], [settings.fileHistoryFolder], settings.storeFolder, new Date(), reportProgress);
    // const results = buildInverseReposForFiles(settings.projectFolder, projectFiles, transcriptsToParse, [settings.fileHistoryFolder], settings.storeFolder, new Date(), reportProgress);
    const results = buildInverseReposForFiles(settings.projectFolder, projectFiles, transcriptsToParse, settings.fileHistoryFolders, settings.storeFolder, new Date(), reportProgress);
    const commitTotal = results.reduce((sum, result) => sum + result.commitCount, 0);
    const seconds = ((Date.now() - startMilliseconds) / 1000).toFixed(1);
    console.log(`done: ${results.length} files, ${commitTotal} commits, ${seconds}s`);
}
