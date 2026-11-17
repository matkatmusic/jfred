// Step B of the layered search: keep the logs whose working folder is in the project or in a worktree of the repo.

import { Path } from "../src/structures/domain.ts";
import { isPathInsideAnyFolder, isPathInsideFolder } from "./layeredSearch_path_checks.ts";
import { printProgress, readFirstTranscriptStringField } from "./layeredSearch_ripgrep_helpers.ts";

export function filterTranscriptsByCwd(candidateTranscripts: Path[], projectFolder: Path, worktreeFolders: Path[]): Path[] {
    const keptTranscripts: Path[] = [];
    let droppedForNoCwdCount = 0;
    const startMilliseconds = Date.now();
    for (const [index, transcript] of candidateTranscripts.entries()) {
        const cwdText = readFirstTranscriptStringField(transcript, "cwd");
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
        printProgress(`B: ${index + 1}/${candidateTranscripts.length} logs checked, ${keptTranscripts.length} kept, ${droppedForNoCwdCount} dropped (no cwd), ${Date.now() - startMilliseconds} ms`);
    }
    process.stderr.write("\n");
    console.log(`step B: ${droppedForNoCwdCount} logs dropped because they have no cwd`);
    return keptTranscripts;
}
