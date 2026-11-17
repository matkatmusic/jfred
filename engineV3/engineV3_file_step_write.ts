// Steps one file to its next text change and writes the commit, for the command line and the server.
import type { Path } from "../src/structures/domain.ts";
import { insertStatesIntoInverseRepo, listInverseCommits, type InverseCommit } from "./engineV3_inverse_repo.ts";
import { stepFileToNextTextChange, type FileStep, type FileStepResult } from "./engineV3_file_step.ts";

export type WrittenStepResult = { result: FileStepResult; tipCommit: InverseCommit };

export function stepFileAndWriteCommit(repoFolder: Path, fileName: string, step: FileStep, boundInstant: Date | undefined): WrittenStepResult {
    const result = stepFileToNextTextChange(step, boundInstant);
    if (result.writtenState !== undefined) {
        insertStatesIntoInverseRepo(repoFolder, fileName, [result.writtenState]);
    }
    const storedCommits = listInverseCommits(repoFolder, fileName, false);
    return { result, tipCommit: storedCommits[storedCommits.length - 1]! };
}
