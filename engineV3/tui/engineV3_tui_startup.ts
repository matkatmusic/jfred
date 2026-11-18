// The start of the TUI: loading screen, project cache load, store reset question.

import { join } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { Path } from "../../src/structures/domain.ts";
import { readEarliestBoundary, type EarliestBoundary } from "../engineV3_earliest_boundary.ts";
import { forceResetStoreFolder, isFullBuildRepoInStore } from "../engineV3_step_store_guard.ts";
import { createLoadingScreen, runProjectCacheChild } from "./engineV3_tui_cache_child.ts";
import type { EngineLog } from "./engineV3_tui_engine_log.ts";
import { loadKeyBoxes, loadKeymap } from "./engineV3_tui_keymap.ts";
import { LegendFrame } from "./engineV3_tui_legend_frame.tsx";
import { getProjectCacheFile, readProjectCache } from "./engineV3_tui_project_cache.ts";
// import { clearTerminalScreen } from "./engineV3_tui_screen.ts";
import { enterAlternateScreen, leaveAlternateScreen } from "./engineV3_tui_screen.ts";
// import { prepareTuiStore, readTuiSettings } from "./engineV3_tui_settings.ts";
import { prepareTuiStore, releaseTuiLock, type readTuiSettings } from "./engineV3_tui_settings.ts";
import { StoreAnswer, StoreQuestion } from "./engineV3_tui_store_question.ts";

// export async function loadProjectForTui(settings: ReturnType<typeof readTuiSettings>, tuiFolder: string, jfredFolder: Path) {
export async function loadProjectForTui(settings: ReturnType<typeof readTuiSettings>, tuiFolder: string, jfredFolder: Path, engineLog: EngineLog) {
    const { projectFolder, storeFolder } = settings;
    const keymapFile = new Path(join(tuiFolder, "keymap.json"));
    const keymap = loadKeymap(keymapFile);
    const keyBoxes = loadKeyBoxes(keymapFile);
    // clearTerminalScreen(process.stdout);
    enterAlternateScreen(process.stdout);
    process.on("exit", () => leaveAlternateScreen(process.stdout));
    // const instance = render(createLoadingScreen("files done 0 of ?"));
    // await runProjectCacheChild(jfredFolder, (progressText) => instance.rerender(createLoadingScreen(progressText)));
    let loadingText = "files done 0 of ?";
    const instance = render(createLoadingScreen(loadingText, engineLog));
    const drawLoadingScreen = (): void => instance.rerender(createLoadingScreen(loadingText, engineLog));
    await runProjectCacheChild(jfredFolder, { showProgress: (progressText) => { loadingText = progressText; drawLoadingScreen(); }, engineLog, onLogChanged: drawLoadingScreen });
    const cache = readProjectCache(getProjectCacheFile(storeFolder));
    let earliestBoundary: EarliestBoundary | undefined;
    if (settings.repoFolder !== undefined) {
        earliestBoundary = readEarliestBoundary(settings.repoFolder, settings.commit!);
    }
    const projectFiles = cache.projectFiles.map((file) => ({ file, transcriptFile: file }));
    // Late on purpose: the real project file list exists only after the cache is loaded.
    prepareTuiStore(storeFolder, projectFolder, projectFiles);
    if (isFullBuildRepoInStore(storeFolder, projectFolder, projectFiles)) {
        // instance.rerender(createLoadingScreen(STORE_QUESTION_TEXT));
        // const storeAnswer = await readAbortOrResetAnswer(process.stdin);
        const storeAnswer = await new Promise<StoreAnswer>((resolve) => instance.rerender(createElement(LegendFrame, null, createElement(StoreQuestion, { onAnswer: resolve }))));
        if (storeAnswer === StoreAnswer.Abort) {
            releaseTuiLock(storeFolder);
            instance.unmount();
            process.exit(0);
        }
        // resetStoreFolder(storeFolder);
        forceResetStoreFolder(storeFolder);
        // instance.rerender(createLoadingScreen("the store is reset: the load continues"));
        loadingText = "the store is reset: the load continues";
        drawLoadingScreen();
    }
    return { instance, keymap, keyBoxes, cache, earliestBoundary, projectFiles };
}
