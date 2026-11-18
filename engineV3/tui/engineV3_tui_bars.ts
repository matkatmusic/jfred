// The TUI bar data: wires of a partial step repo, bar models, and the info row counts.

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { Path } from "../../src/structures/domain.ts";
import { buildInverseCommitWire } from "../../src/layer1_inverse_repos_wire.ts";
import { buildBarFileModels, describeFinalState, describeFoldedState, isBarFileChangedSince, type BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import type { InverseRepoFileWire } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { FileEventType } from "../engineV3_replay_reverse_events.ts";
import { isModifyingEventType } from "../engineV3_file_step.ts";
import { listInverseCommits } from "../engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile, getRelativePathInProject } from "../engineV3_inverse_repos_for_project.ts";
import type { FileEventCounts } from "./engineV3_tui_project_cache.ts";
import type { FileRunState } from "./engineV3_tui_walk_state.ts";

export type BarInfo = {
    commitCount: number;
    modifyingEventCount: number;
    snapshotCount: number;
    scriptCount: number;
    failedReplayCount: number;
    stateText: string;
    errorText: string | undefined;
};

export function listInverseRepoFileWire(storeFolder: Path, projectFolder: Path, file: Path): InverseRepoFileWire {
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
    // const commits = listInverseCommits(repoFolder, basename(file.toString()), false).map(buildInverseCommitWire);
    let commits: InverseRepoFileWire["commits"] = [];
    if (existsSync(repoFolder.toString())) {
        commits = listInverseCommits(repoFolder, basename(file.toString()), false).map(buildInverseCommitWire);
    }
    return { file: getRelativePathInProject(projectFolder, file), commits };
}

export const buildTuiBarModels = buildBarFileModels;

export function describeBarInfo(model: BarFileModel, counts: FileEventCounts, runState: FileRunState): BarInfo {
    let modifyingEventCount = 0;
    for (const eventType of Object.values(FileEventType)) {
        if (isModifyingEventType(eventType)) {
            modifyingEventCount += counts[eventType];
        }
    }
    // The selected row is the oldest row the file exists at: the TUI shows the whole undo.
    const selectedRowIndex = model.bornRowIndex;
    const isChanged = isBarFileChangedSince(model, selectedRowIndex);
    const stateText = isChanged ? describeFinalState(model, selectedRowIndex) : describeFoldedState(model, selectedRowIndex);
    return {
        commitCount: model.commits.length,
        modifyingEventCount,
        snapshotCount: counts[FileEventType.BackupSnapshot],
        scriptCount: counts[FileEventType.ScriptMayWrite] + counts[FileEventType.ScriptReadOnly],
        failedReplayCount: runState.failedReplayCount,
        stateText,
        errorText: runState.reasonText,
    };
}
