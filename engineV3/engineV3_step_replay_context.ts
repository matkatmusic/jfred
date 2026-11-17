// The program context the replay command needs, its output, and the replay list it caches.

import type { Path } from "../src/structures/domain.ts";
import type { ProgressSink } from "../src/parse/loadTranscript.ts";
import type { ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { listProjectFilesOnDiskAndInLogs } from "./engineV3_inverse_repos_project_files.ts";
import type { WalkedOtherFile } from "./engineV3_step_other_files.ts";

// replayFiles and walkedOtherFiles stay undefined until the first r that passes its refusals; then the command caches them here.
export type StepReplayContext = {
    projectFolder: Path;
    jsonlsFolder: Path;
    transcriptsToParse: Path[];
    fileHistoryFolder: Path;
    storeFolder: Path;
    stepProjectFile: ProjectFile;
    replayFiles: ProjectFile[] | undefined;
    walkedOtherFiles: WalkedOtherFile[] | undefined;
};

// isContainerFailure is true only when the container run failed; every other refusal and a done replay give false.
export type ReplayCommandOutput = { line: string; positions: number[]; isContainerFailure?: boolean };

export function listReplayFilesOfProject(replay: StepReplayContext): ProjectFile[] {
    if (replay.replayFiles === undefined) {
        let scannedLogCount = 0;
        const reportLogScanned: ProgressSink = () => {
            scannedLogCount += 1;
            process.stderr.write(`scanned ${scannedLogCount} logs\r`);
        };
        const scannedFiles = listProjectFilesOnDiskAndInLogs(replay.projectFolder, [replay.jsonlsFolder], reportLogScanned);
        process.stderr.write("\n");
        const isStepFileListed = scannedFiles.some((projectFile) => projectFile.file.equals(replay.stepProjectFile.file));
        if (!isStepFileListed) {
            scannedFiles.push(replay.stepProjectFile);
        }
        replay.replayFiles = scannedFiles;
    }
    return replay.replayFiles;
}
