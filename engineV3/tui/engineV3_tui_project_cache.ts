import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../../src/structures/domain.ts";
import type { EarliestBoundary } from "../engineV3_earliest_boundary.ts";
import { isModifyingEventType } from "../engineV3_file_step.ts";
import { createProjectEventsLoader, type ProjectFile } from "../engineV3_inverse_repos_for_project.ts";
import { buildLineSourceIndex, getLineSourceIndexFile, writeLineSourceIndex, type LineSourceIndex } from "../engineV3_jsonl_lines_source_index.ts";
import { listProjectFilesOnDiskAndInLogs } from "../engineV3_inverse_repos_project_files.ts";
import { FileEventType } from "../engineV3_replay_reverse_events.ts";
import { formatSourceText } from "../engineV3_step_replay_command.ts";
import { getRepoFolderOfProject, listLayeredSearchProjectFiles } from "../layeredSearch/layeredSearch_project_files.ts";
import { computeProjectCacheInputsHash } from "./engineV3_tui_project_cache_hash.ts";

export type TuiInput = { projectFolder: Path; jsonlsFolders: Path[]; fileHistoryFolders: Path[]; storeFolder: Path; earliestBoundary: EarliestBoundary | undefined };
export type ProjectEventEntry = { instant: Date; file: Path; eventType: FileEventType; source: string | null };
export type FileEventCounts = Record<FileEventType, number>;
export type ProjectCache = { inputsHash: string; projectFiles: Path[]; replayFiles: Path[]; transcriptsToParse: Path[]; events: ProjectEventEntry[]; countsByFile: Map<string, FileEventCounts>; scriptCounts: { mayWrite: number; readOnly: number }; lineSourceIndex?: LineSourceIndex };
export type FileProgress = { file: Path; current: number; total: number };

export type ProjectCacheJson = {
    inputsHash: string;
    projectFiles: string[];
    replayFiles: string[];
    transcriptsToParse: string[];
    events: { instant: string; file: string; eventType: FileEventType; source: string | null }[];
    countsByFile: Record<string, FileEventCounts>;
    scriptCounts: { mayWrite: number; readOnly: number };
};

function createEmptyEventCounts(): FileEventCounts {
    const counts = {} as FileEventCounts;
    for (const eventType of Object.values(FileEventType)) {
        counts[eventType] = 0;
    }
    return counts;
}

function listProjectFilesOfInput(input: TuiInput): { projectFiles: ProjectFile[]; transcriptsToParse: Path[] } {
    const repoFolder = getRepoFolderOfProject(input.projectFolder);
    return listLayeredSearchProjectFiles(input.projectFolder, repoFolder, input.jsonlsFolders, false, () => {});
}

function buildProjectCacheFromFileLists(input: TuiInput, inputsHash: string, projectFiles: ProjectFile[], transcriptsToParse: Path[], reportFileProgress?: (progress: FileProgress) => void): ProjectCache {
    const replayFiles = listProjectFilesOnDiskAndInLogs(input.projectFolder, input.jsonlsFolders).map((projectFile) => projectFile.file);
    let lineSourceIndex: LineSourceIndex | undefined;
    const getEvents = createProjectEventsLoader(projectFiles, transcriptsToParse, input.fileHistoryFolders, input.earliestBoundary, (linesByFileKey) => { lineSourceIndex = buildLineSourceIndex(linesByFileKey); });
    const events: ProjectEventEntry[] = [];
    const countsByFile = new Map<string, FileEventCounts>();
    const mayWriteSources = new Set<string>();
    const readOnlySources = new Set<string>();
    for (const [index, projectFile] of projectFiles.entries()) {
        const counts = createEmptyEventCounts();
        for (const event of getEvents(index)) {
            counts[event.type] += 1;
            const source = formatSourceText(event.source);
            if (event.type === FileEventType.ScriptMayWrite) {
                if (source !== null) {
                    mayWriteSources.add(source);
                }
            }
            if (event.type === FileEventType.ScriptReadOnly) {
                if (source !== null) {
                    readOnlySources.add(source);
                }
            }
            if (event.instant !== undefined) {
                if (isModifyingEventType(event.type)) {
                    events.push({ instant: event.instant, file: projectFile.file, eventType: event.type, source });
                }
            }
        }
        countsByFile.set(projectFile.file.toString(), counts);
        if (reportFileProgress !== undefined) {
            reportFileProgress({ file: projectFile.file, current: index + 1, total: projectFiles.length });
        }
    }
    events.sort((first, second) => second.instant.getTime() - first.instant.getTime());
    return { inputsHash, projectFiles: projectFiles.map((projectFile) => projectFile.file), replayFiles, transcriptsToParse, events, countsByFile, scriptCounts: { mayWrite: mayWriteSources.size, readOnly: readOnlySources.size }, lineSourceIndex };
}

export function buildProjectCache(input: TuiInput, reportFileProgress?: (progress: FileProgress) => void): ProjectCache {
    const { projectFiles, transcriptsToParse } = listProjectFilesOfInput(input);
    const inputsHash = computeProjectCacheInputsHash(input, projectFiles.map((projectFile) => projectFile.file), transcriptsToParse);
    return buildProjectCacheFromFileLists(input, inputsHash, projectFiles, transcriptsToParse, reportFileProgress);
}

export function writeProjectCache(cacheFile: Path, cache: ProjectCache): void {
    const json: ProjectCacheJson = {
        inputsHash: cache.inputsHash,
        projectFiles: cache.projectFiles.map((file) => file.toString()),
        replayFiles: cache.replayFiles.map((file) => file.toString()),
        transcriptsToParse: cache.transcriptsToParse.map((file) => file.toString()),
        events: cache.events.map((event) => ({ instant: event.instant.toISOString(), file: event.file.toString(), eventType: event.eventType, source: event.source })),
        countsByFile: Object.fromEntries(cache.countsByFile),
        scriptCounts: cache.scriptCounts,
    };
    const temporaryFile = `${cacheFile.toString()}.tmp`;
    mkdirSync(dirname(cacheFile.toString()), { recursive: true });
    writeFileSync(temporaryFile, JSON.stringify(json));
    renameSync(temporaryFile, cacheFile.toString());
    if (cache.lineSourceIndex !== undefined) {
        writeLineSourceIndex(getLineSourceIndexFile(cacheFile), cache.lineSourceIndex);
    }
}

export function readProjectCache(cacheFile: Path): ProjectCache {
    const json = JSON.parse(readFileSync(cacheFile.toString(), "utf8")) as ProjectCacheJson;
    return {
        inputsHash: json.inputsHash,
        projectFiles: json.projectFiles.map((file) => new Path(file)),
        replayFiles: json.replayFiles.map((file) => new Path(file)),
        transcriptsToParse: json.transcriptsToParse.map((file) => new Path(file)),
        events: json.events.map((event) => ({ instant: new Date(event.instant), file: new Path(event.file), eventType: event.eventType, source: event.source })),
        countsByFile: new Map(Object.entries(json.countsByFile)),
        scriptCounts: json.scriptCounts,
    };
}

export function getProjectCacheFile(storeFolder: Path): Path {
    const jfredFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    return new Path(join(jfredFolder, ".cache", "tui", basename(storeFolder.toString()), "project-cache.json"));
}

// export function loadOrBuildProjectCache(input: TuiInput, cacheFile: Path): { cache: ProjectCache; wasRebuilt: boolean } {
export function loadOrBuildProjectCache(input: TuiInput, cacheFile: Path, reportFileProgress?: (progress: FileProgress) => void): { cache: ProjectCache; wasRebuilt: boolean } {
    const { projectFiles, transcriptsToParse } = listProjectFilesOfInput(input);
    const inputsHash = computeProjectCacheInputsHash(input, projectFiles.map((projectFile) => projectFile.file), transcriptsToParse);
    if (existsSync(cacheFile.toString())) {
        const storedCache = readProjectCache(cacheFile);
        if (storedCache.inputsHash === inputsHash) {
            return { cache: storedCache, wasRebuilt: false };
        }
    }
    const cache = buildProjectCacheFromFileLists(input, inputsHash, projectFiles, transcriptsToParse, reportFileProgress);
    writeProjectCache(cacheFile, cache);
    return { cache, wasRebuilt: true };
}
