// Step B of the layered search: keep the logs whose working folder is in the project or in a worktree of the repo.

import { Path } from "../../src/structures/domain.ts";
import { isPathInsideAnyFolder, isPathInsideFolder } from "./layeredSearch_path_checks.ts";
import { readFirstStringFieldOfAllTranscripts } from "./layeredSearch_ripgrep_helpers.ts";

export function filterTranscriptsByCwd(candidateTranscripts: Path[], jsonlsFolders: Path[], projectFolder: Path, worktreeFolders: Path[]): Path[] {
    const startMilliseconds = Date.now();
    const cwdsByTranscript = readFirstStringFieldOfAllTranscripts(jsonlsFolders, "cwd");
    process.stderr.write(`B: read the cwd of ${cwdsByTranscript.size} logs in one search, ${Date.now() - startMilliseconds} ms\n`);
    const keptTranscripts: Path[] = [];
    let droppedForNoCwdCount = 0;
    for (const transcript of candidateTranscripts) {
        const cwdText = cwdsByTranscript.get(transcript.toString());
        if (cwdText === undefined) {
            droppedForNoCwdCount += 1;
        }
        else {
            const cwd = new Path(cwdText);
            let isTranscriptKept = isPathInsideFolder(cwd, projectFolder);
            if (!isTranscriptKept) {
                isTranscriptKept = isPathInsideAnyFolder(cwd, worktreeFolders);
            }
            if (isTranscriptKept) {
                keptTranscripts.push(transcript);
            }
        }
    }
    console.log(`step B: ${droppedForNoCwdCount} logs dropped because they have no cwd`);
    return keptTranscripts;
}
