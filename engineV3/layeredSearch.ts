// Layered search: list the files of the project and of git, find the logs that mention them (A), keep the logs from the project (B), add the files those logs mention (C), and write the list to a JSON file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { readLayeredSearchCommandFromArguments } from "./layeredSearch_command.ts";
import { listGitTouchedFilePaths, listProjectFilePaths, mergeFilePathsWithoutDuplicates } from "./layeredSearch_file_lists.ts";
import { filterTranscriptsByCwd } from "./layeredSearch_filter_transcripts.ts";
import { findCandidateTranscripts } from "./layeredSearch_find_transcripts.ts";
import { addFilesMentionedInTranscripts } from "./layeredSearch_mentioned_files.ts";
import { listRepoWorktreeFolders } from "./layeredSearch_path_checks.ts";

function writeJsonFile(outputFile: Path, content: object): void {
    mkdirSync(dirname(outputFile.toString()), { recursive: true });
    writeFileSync(outputFile.toString(), JSON.stringify(content, null, 2) + "\n");
}

// Comment out a step block (from the last one up) to see how long the steps before it take.
export async function main(argumentList: string[]): Promise<void> {
    const command = readLayeredSearchCommandFromArguments(argumentList);
    const startTime = new Date();
    const stepMilliseconds: Record<string, number> = {};
    const worktreeFolders = listRepoWorktreeFolders(command.repoFolder);
    const diskFiles = listProjectFilePaths(command.projectFolder);
    const gitFiles = listGitTouchedFilePaths(command.repoFolder, command.projectFolder, command.isOutsideProjectIncluded);
    let files = mergeFilePathsWithoutDuplicates(diskFiles, gitFiles);
    let candidateTranscripts: Path[] = [];
    let transcriptsToParse: Path[] = [];

    const stepAStart = Date.now();
    candidateTranscripts = await findCandidateTranscripts(files, command.jsonlsFolder, command.ripgrepSearchMode);
    stepMilliseconds.stepA = Date.now() - stepAStart;
    console.log(`step A: ${candidateTranscripts.length} logs mention a path, ${stepMilliseconds.stepA} ms`);

    const stepBStart = Date.now();
    transcriptsToParse = filterTranscriptsByCwd(candidateTranscripts, command.jsonlsFolder, command.projectFolder, worktreeFolders);
    stepMilliseconds.stepB = Date.now() - stepBStart;
    console.log(`step B: ${transcriptsToParse.length} logs kept, ${stepMilliseconds.stepB} ms`);

    const stepCStart = Date.now();
    files = addFilesMentionedInTranscripts(files, transcriptsToParse, command, worktreeFolders);
    stepMilliseconds.stepC = Date.now() - stepCStart;
    console.log(`step C: ${files.length} files in the list, ${stepMilliseconds.stepC} ms`);

    const endTime = new Date();
    const elapsedMilliseconds = endTime.getTime() - startTime.getTime();
    writeJsonFile(command.outputFile, {
        repoFolder: command.repoFolder.toString(),
        jsonlsFolder: command.jsonlsFolder.toString(),
        projectFolder: command.projectFolder.toString(),
        ripgrepSearchMode: command.ripgrepSearchMode,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        elapsedMilliseconds,
        stepMilliseconds,
        fileCount: files.length,
        candidateTranscripts,
        transcriptsToParse,
        files,
    });
    console.log(`startTime: ${startTime.toISOString()}`);
    console.log(`endTime: ${endTime.toISOString()}`);
    console.log(`elapsedMilliseconds: ${elapsedMilliseconds}`);
    console.log(`fileCount: ${files.length}`);
    console.log(`jsonFile: "${command.outputFile.toString()}"`);
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
    await main(process.argv.slice(2));
}
