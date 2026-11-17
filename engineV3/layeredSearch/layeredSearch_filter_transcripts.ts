// Step B of the layered search: keep a log when its cwd is in the project or in a worktree of the repo (rule 1),
// or when it holds a file_path inside the project folder (rule 2).

import { Path } from "../../src/structures/domain.ts";
import { isPathInsideAnyFolder, isPathInsideFolder } from "./layeredSearch_path_checks.ts";
import { listTranscriptsNamingProjectFilePaths, readFirstStringFieldOfAllTranscripts } from "./layeredSearch_ripgrep_helpers.ts";

// export function filterTranscriptsByCwd(candidateTranscripts: Path[], jsonlsFolders: Path[], projectFolder: Path, worktreeFolders: Path[]): Path[] {
export function filterTranscriptsByCwdOrFilePath(candidateTranscripts: Path[], jsonlsFolders: Path[], projectFolder: Path, worktreeFolders: Path[]): Path[] {
    const startMilliseconds = Date.now();
    const cwdsByTranscript = readFirstStringFieldOfAllTranscripts(jsonlsFolders, "cwd");
    process.stderr.write(`B: read the cwd of ${cwdsByTranscript.size} logs in one search, ${Date.now() - startMilliseconds} ms\n`);
    const filePathSearchStartMilliseconds = Date.now();
    const transcriptsNamingProjectFilePaths = listTranscriptsNamingProjectFilePaths(jsonlsFolders, projectFolder);
    // process.stderr.write(`B: found ${transcriptsNamingProjectFilePaths.size} logs naming a file of the project in one search, ${Date.now() - filePathSearchStartMilliseconds} ms\n`);
    process.stderr.write(`B: found ${transcriptsNamingProjectFilePaths.size} logs naming the project folder in one search, ${Date.now() - filePathSearchStartMilliseconds} ms\n`);
    const keptTranscripts: Path[] = [];
    let keptByCwdCount = 0;
    let keptByFilePathCount = 0;
    let droppedForNoCwdCount = 0;
    for (const transcript of candidateTranscripts) {
        const cwdText = cwdsByTranscript.get(transcript.toString());
        let isKeptByCwd = false;
        if (cwdText !== undefined) {
            const cwd = new Path(cwdText);
            isKeptByCwd = isPathInsideFolder(cwd, projectFolder);
            if (!isKeptByCwd) {
                isKeptByCwd = isPathInsideAnyFolder(cwd, worktreeFolders);
            }
        }
        if (isKeptByCwd) {
            keptByCwdCount += 1;
            keptTranscripts.push(transcript);
        }
        else {
            if (transcriptsNamingProjectFilePaths.has(transcript.toString())) {
                keptByFilePathCount += 1;
                keptTranscripts.push(transcript);
            }
            else {
                if (cwdText === undefined) {
                    droppedForNoCwdCount += 1;
                }
            }
        }
    }
    // console.log(`step B: ${droppedForNoCwdCount} logs dropped because they have no cwd`);
    console.log(`step B: ${keptByCwdCount} logs kept by cwd, ${keptByFilePathCount} logs kept by file path, ${droppedForNoCwdCount} logs dropped because they have no cwd`);
    return keptTranscripts;
}
