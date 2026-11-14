// Builds the inverse repo of every file of a project, reading the transcripts one time for all files.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { listCurrentFileState } from "../src/layer1_disk_walk.ts";
import type { ProgressSink } from "../src/parse/loadTranscript.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { StateConfidence, getTextJustBeforeInstant, listKnownStatesForFile, type FileKnownState } from "./engineV3_file_known_states.ts";
import { buildInverseRepoByEventKind } from "./engineV3_inverse_repo.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import type { JSONLLine } from "./engineV3.ts";
import { loadJSONLLinesNamingFiles } from "./engineV3_jsonl_lines_naming_files.ts";
import { getAllEventsForFileFromLines, sortEventsNewestToOldest, type FileEvent } from "./engineV3_replay_reverse_events.ts";

export type FileInverseRepoResult = { file: Path; repoFolder: Path; eventCount: number; stateCount: number; commitCount: number; unknownStateCount: number; wasReused: boolean };

// The inputs a repo was built from: the bytes on disk, the log path of the file, and the log files with size and modified time.
type InverseRepoStampInputs = { diskBytesHash: string; transcriptFile: string; logFilesHash: string };
type InverseRepoStamp = { inputs: InverseRepoStampInputs; eventCount: number; stateCount: number; commitCount: number; unknownStateCount: number };

const STAMP_FILE_NAME = "jfred-stamp.json";
const ABSENT_DISK_BYTES_HASH = "absent";

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

function findProjectFileIndexByTranscriptFile(projectFiles: ProjectFile[], transcriptFile: Path): number | undefined {
    for (const [index, projectFile] of projectFiles.entries()) {
        if (projectFile.transcriptFile.equals(transcriptFile)) {
            return index;
        }
    }
    return undefined;
}

// A file born by a move or a copy takes the text its source file had just before that event, so the source states come first.
function listStatesOfProjectFile(fileIndex: number, projectFiles: ProjectFile[], getEvents: (fileIndex: number) => FileEvent[], statesByFile: (FileKnownState[] | undefined)[], fileIndexesBeingComputed: Set<number>): FileKnownState[] {
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

// Log files only grow when new lines arrive, so their size and modified time change with every new line of the project.
function getLogFilesHash(jsonlsFolders: Path[]): string {
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

function isStampBuiltFromInputs(stamp: InverseRepoStamp, inputs: InverseRepoStampInputs): boolean {
    if (stamp.inputs.diskBytesHash === inputs.diskBytesHash) {
        if (stamp.inputs.transcriptFile === inputs.transcriptFile) {
            return stamp.inputs.logFilesHash === inputs.logFilesHash;
        }
    }
    return false;
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
    let linesByFileKey: Map<string, JSONLLine[]> | undefined;
    const eventsByFile: (FileEvent[] | undefined)[] = projectFiles.map(() => undefined);
    const getEvents = (fileIndex: number): FileEvent[] => {
        const computedEvents = eventsByFile[fileIndex];
        if (computedEvents !== undefined) {
            return computedEvents;
        }
        if (linesByFileKey === undefined) {
            linesByFileKey = loadJSONLLinesNamingFiles(projectFiles.map((projectFile) => projectFile.transcriptFile), jsonlsFolders);
        }
        const { file, transcriptFile } = projectFiles[fileIndex]!;
        const events = sortEventsNewestToOldest(getAllEventsForFileFromLines(file, transcriptFile, linesByFileKey.get(transcriptFile.toString())!, snapshotFolders));
        eventsByFile[fileIndex] = events;
        return events;
    };
    const statesByFile: (FileKnownState[] | undefined)[] = projectFiles.map(() => undefined);
    const fileIndexesBeingComputed = new Set<number>();
    const results: FileInverseRepoResult[] = [];
    for (const [index, { file, transcriptFile }] of projectFiles.entries()) {
        const repoFolder = repoFolders[index]!;
        const inputs: InverseRepoStampInputs = { diskBytesHash: getDiskBytesHash(file), transcriptFile: transcriptFile.toString(), logFilesHash };
        const existingStamp = readInverseRepoStamp(repoFolder);
        const relativeFile = getRelativePathInProject(projectFolder, file);
        const projectRelativeFile = relativeFile.split(sep).join("/");
        let result: FileInverseRepoResult | undefined;
        if (existingStamp !== undefined) {
            if (isStampBuiltFromInputs(existingStamp, inputs)) {
                result = { file, repoFolder, eventCount: existingStamp.eventCount, stateCount: existingStamp.stateCount, commitCount: existingStamp.commitCount, unknownStateCount: existingStamp.unknownStateCount, wasReused: true };
            }
        }
        if (result === undefined) {
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
            buildInverseRepoByEventKind(repoFolder, basename(file.toString()), states, diskNowInstant, reportStepDone);
            result = { file, repoFolder, eventCount: events.length, stateCount: states.length, commitCount, unknownStateCount, wasReused: false };
            writeInverseRepoStamp(repoFolder, { inputs, eventCount: result.eventCount, stateCount: result.stateCount, commitCount: result.commitCount, unknownStateCount });
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
    // const files = listCurrentFileState(settings.projectFolder).map((fileState) => new Path(join(settings.projectFolder.toString(), fileState.relativePath.toString())));
    // const projectFiles = files.map((file) => ({ file, transcriptFile: file }));
    const { listProjectFilesOnDiskAndInLogs } = await import("./engineV3_inverse_repos_project_files.ts");
    const projectFiles = listProjectFilesOnDiskAndInLogs(settings.projectFolder, [settings.jsonlsFolder]);
    const files = projectFiles.map((projectFile) => projectFile.file);
    const { createTerminalBarsSink } = await import("./engineV3_inverse_repos_terminal_bars.ts");
    const fileNames = files.map((file) => relative(settings.projectFolder.toString(), file.toString()));
    // const reportProgress = (event) => { console.log(`${event.current}/${event.total}  ${event.label}`); };
    const reportProgress = createTerminalBarsSink(process.stdout, fileNames);
    const results = buildInverseReposForFiles(settings.projectFolder, projectFiles, [settings.jsonlsFolder], [settings.fileHistoryFolder], settings.storeFolder, new Date(), reportProgress);
    const commitTotal = results.reduce((sum, result) => sum + result.commitCount, 0);
    const seconds = ((Date.now() - startMilliseconds) / 1000).toFixed(1);
    console.log(`done: ${results.length} files, ${commitTotal} commits, ${seconds}s`);
}
