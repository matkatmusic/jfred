// Wiring helpers of the TUI start file: the status listeners and the two store reset handlers.

import type { Path } from "../../src/structures/domain.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";
import { resetAllStores, resetStoresOfFiles } from "./engineV3_tui_reset.ts";
import type { FileRunState, WalkState } from "./engineV3_tui_walk_state.ts";
import type { StepPool } from "./engineV3_tui_walk_types.ts";

export type StatusChangeWiring = {
    handleStatusChange: (file: Path, runState: FileRunState) => void;
    clearRunStateOfFile: (file: Path) => void;
    subscribeToStatusChanges: (listener: () => void) => () => void;
};

export type ResetHandlers = {
    resetSelectedStores: (files: Path[]) => Promise<void>;
    resetAllStoresOfProject: () => Promise<void>;
};

export type ResetHandlersOptions = {
    storeFolder: Path;
    projectFolder: Path;
    pool: StepPool;
    walkState: WalkState;
    clearRunStateOfFile: (file: Path) => void;
    refreshStaleRepoCount: () => void;
};

export function createStatusChangeWiring(walkState: WalkState): StatusChangeWiring {
    const statusListeners = new Set<() => void>();
    const notifyStatusListeners = (): void => statusListeners.forEach((statusListener) => statusListener());
    return {
        handleStatusChange: (file, runState) => {
            walkState.setRunState(file, runState);
            notifyStatusListeners();
        },
        clearRunStateOfFile: (file) => {
            walkState.clearRunState(file);
            notifyStatusListeners();
        },
        subscribeToStatusChanges: (listener) => {
            statusListeners.add(listener);
            return () => {
                statusListeners.delete(listener);
            };
        },
    };
}

export function createResetHandlers(options: ResetHandlersOptions): ResetHandlers {
    const { storeFolder, projectFolder, pool, walkState, clearRunStateOfFile, refreshStaleRepoCount } = options;
    return {
        resetSelectedStores: async (files) => {
            const fileStores = files.map((file) => ({ file, repoFolder: getInverseRepoFolderForFile(storeFolder, projectFolder, file) }));
            await resetStoresOfFiles(storeFolder, fileStores, pool.cancelFile, clearRunStateOfFile);
            refreshStaleRepoCount();
        },
        resetAllStoresOfProject: async () => {
            await resetAllStores(storeFolder, pool.cancelAll, () => walkState.listFiles().forEach(clearRunStateOfFile));
            refreshStaleRepoCount();
        },
    };
}
