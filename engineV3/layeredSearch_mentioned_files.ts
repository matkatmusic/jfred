// Step C of the layered search: add the files that the kept logs mention, when they are in the project, a worktree, or the session scratchpad.

import { join, relative, resolve, sep } from "node:path";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { listEventPaths } from "../src/reconstruction_bound.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { Path } from "../src/structures/domain.ts";
import { LayeredSearchCommand } from "./layeredSearch_command.ts";
import { isPathInSessionScratchpad, isPathInsideFolder } from "./layeredSearch_path_checks.ts";
import { printProgress, readRequiredTranscriptStringField } from "./layeredSearch_ripgrep_helpers.ts";

// Project files are listed relative to the project, worktree files by their place in the main repo, scratchpad files by their full path.
function convertMentionedPathToListEntry(fullPath: Path, command: LayeredSearchCommand, worktreeFolders: Path[], sessionId: string): string | undefined {
    if (isPathInsideFolder(fullPath, command.projectFolder)) {
        return relative(command.projectFolder.toString(), fullPath.toString());
    }
    for (const worktreeFolder of worktreeFolders) {
        if (isPathInsideFolder(fullPath, worktreeFolder)) {
            const repoRelativePath = relative(worktreeFolder.toString(), fullPath.toString());
            const projectRelativePath = relative(command.projectFolder.toString(), join(command.repoFolder.toString(), repoRelativePath));
            const isInsideProject = projectRelativePath.split(sep)[0] !== "..";
            if (isInsideProject) {
                return projectRelativePath;
            }
            if (command.isOutsideProjectIncluded) {
                return projectRelativePath;
            }
            return undefined;
        }
    }
    if (isPathInSessionScratchpad(fullPath, sessionId)) {
        return fullPath.toString();
    }
    return undefined;
}

export function addFilesMentionedInTranscripts(files: string[], transcriptsToParse: Path[], command: LayeredSearchCommand, worktreeFolders: Path[]): string[] {
    const allFiles = new Set(files);
    const startMilliseconds = Date.now();
    for (const [index, transcript] of transcriptsToParse.entries()) {
        const cwd = readRequiredTranscriptStringField(transcript, "cwd");
        const sessionId = readRequiredTranscriptStringField(transcript, "sessionId");
        const records = loadTranscript(transcript.toString(), undefined, true).records;
        for (const event of extractFileEvents(records)) {
            for (const eventPath of listEventPaths(event)) {
                const fullPath = new Path(resolve(cwd, eventPath.toString()));
                const listEntry = convertMentionedPathToListEntry(fullPath, command, worktreeFolders, sessionId);
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
