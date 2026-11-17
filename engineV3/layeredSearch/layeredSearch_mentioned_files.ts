// Step C of the layered search: add the files that the kept logs mention, when they are in the project, a worktree, or the session scratchpad.

import { join, relative, resolve } from "node:path";
import { loadTranscript } from "../../src/parse/loadTranscript.ts";
import { listEventPaths } from "../../src/reconstruction_bound.ts";
import { extractFileEvents } from "../../src/reconstruction_extract.ts";
import { Path } from "../../src/structures/domain.ts";
import type { TranscriptRecord } from "../../src/structures/envelope.ts";
import { LayeredSearchCommand } from "./layeredSearch_command.ts";
import { isPathInSessionScratchpad, isPathInsideAnyFolder, isPathInsideFolder } from "./layeredSearch_path_checks.ts";
import { printProgress } from "./layeredSearch_ripgrep_helpers.ts";

// Every entry is a full path. A file in a merged worktree gets its place in the main repo; a file in an unmerged worktree keeps its worktree path.
type MentionedFilesCommand = Pick<LayeredSearchCommand, "repoFolder" | "projectFolder" | "isOutsideProjectIncluded">;

// function convertMentionedPathToListEntry(fullPath: Path, command: LayeredSearchCommand, worktreeFolders: Path[], mergedWorktreeFolders: Path[], sessionId: string): string | undefined {
// function convertMentionedPathToListEntry(fullPath: Path, command: MentionedFilesCommand, worktreeFolders: Path[], mergedWorktreeFolders: Path[], sessionId: string): string | undefined {
function convertMentionedPathToListEntry(fullPath: Path, command: MentionedFilesCommand, worktreeFolders: Path[], mergedWorktreeFolders: Path[], sessionId: string, isLogFromProject: boolean): string | undefined {
    if (isPathInsideFolder(fullPath, command.projectFolder)) {
        return fullPath.toString();
    }
    for (const worktreeFolder of worktreeFolders) {
        if (isPathInsideFolder(fullPath, worktreeFolder)) {
            const isWorktreeMerged = mergedWorktreeFolders.map(String).includes(worktreeFolder.toString());
            if (!isWorktreeMerged) {
                return fullPath.toString();
            }
            const repoRelativePath = relative(worktreeFolder.toString(), fullPath.toString());
            const mainRepoPath = new Path(join(command.repoFolder.toString(), repoRelativePath));
            if (isPathInsideFolder(mainRepoPath, command.projectFolder)) {
                return mainRepoPath.toString();
            }
            if (command.isOutsideProjectIncluded) {
                return mainRepoPath.toString();
            }
            return undefined;
        }
    }
    if (isLogFromProject) {
        if (isPathInSessionScratchpad(fullPath, sessionId)) {
            return fullPath.toString();
        }
    }
    return undefined;
}

// The first record that has the field wins; the records are already loaded, so this costs no extra search.
function readFirstCwdAndSessionIdFromRecords(records: TranscriptRecord[], transcript: Path): { cwd: string; sessionId: string } {
    let cwd: string | undefined;
    let sessionId: string | undefined;
    for (const record of records) {
        if (cwd === undefined) {
            cwd = record.cwd?.toString();
        }
        if (sessionId === undefined) {
            sessionId = record.sessionId?.toString();
        }
    }
    if (cwd === undefined) {
        throw new Error(`${transcript.toString()} has no cwd field`);
    }
    if (sessionId === undefined) {
        throw new Error(`${transcript.toString()} has no sessionId field`);
    }
    return { cwd, sessionId };
}

// export function addFilesMentionedInTranscripts(files: string[], transcriptsToParse: Path[], command: LayeredSearchCommand, worktreeFolders: Path[], mergedWorktreeFolders: Path[]): string[] {
export function addFilesMentionedInTranscripts(files: string[], transcriptsToParse: Path[], command: MentionedFilesCommand, worktreeFolders: Path[], mergedWorktreeFolders: Path[]): string[] {
    const allFiles = new Set(files);
    const startMilliseconds = Date.now();
    for (const [index, transcript] of transcriptsToParse.entries()) {
        const records = loadTranscript(transcript.toString(), undefined, true).records;
        const { cwd, sessionId } = readFirstCwdAndSessionIdFromRecords(records, transcript);
        const cwdPath = new Path(cwd);
        let isLogFromProject = isPathInsideFolder(cwdPath, command.projectFolder);
        if (!isLogFromProject) {
            isLogFromProject = isPathInsideAnyFolder(cwdPath, worktreeFolders);
        }
        for (const event of extractFileEvents(records)) {
            for (const eventPath of listEventPaths(event)) {
                const fullPath = new Path(resolve(cwd, eventPath.toString()));
                // const listEntry = convertMentionedPathToListEntry(fullPath, command, worktreeFolders, mergedWorktreeFolders, sessionId);
                const listEntry = convertMentionedPathToListEntry(fullPath, command, worktreeFolders, mergedWorktreeFolders, sessionId, isLogFromProject);
                if (listEntry !== undefined) {
                    allFiles.add(listEntry);
                }
            }
        }
        printProgress(`C: ${index + 1}/${transcriptsToParse.length} logs read, ${allFiles.size} files, ${Date.now() - startMilliseconds} ms`);
    }
    process.stderr.write("\n");
    return [...allFiles].sort();
}
