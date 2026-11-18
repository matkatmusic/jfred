// The TUI start file: reads the flags, loads the project cache, builds the pool and walker, draws the Ink screen.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { render } from "ink";
import { createElement } from "react";
import { Path } from "../../src/structures/domain.ts";
import { TuiCommand } from "../../src/structures/vocabulary.ts";
import { readEarliestBoundary, type EarliestBoundary } from "../engineV3_earliest_boundary.ts";
import { getInverseRepoFolderForFile, getLogFilesHash, listProjectFilesWithStaleInverseRepos } from "../engineV3_inverse_repos_for_project.ts";
import { isInstantSpannedByWalkCoverage, readWalkCoverage } from "../engineV3_walk_coverage.ts";
import { App } from "./engineV3_tui_app.tsx";
import type { AppProps } from "./engineV3_tui_app_types.ts";
import { runAutoWalk } from "./engineV3_tui_auto.ts";
import { listInverseRepoFileWire } from "./engineV3_tui_bars.ts";
import { createLoadingScreen, runProjectCacheChild } from "./engineV3_tui_cache_child.ts";
import { createConsentGate, decideScriptAction, type ConsentAnswers } from "./engineV3_tui_consent.ts";
import { formatKeyBinding, loadKeymap } from "./engineV3_tui_keymap.ts";
import { createStepPool } from "./engineV3_tui_pool.ts";
import { getProjectCacheFile, readProjectCache } from "./engineV3_tui_project_cache.ts";
// import { acquireTuiLock, prepareTuiStore, readTuiSettings } from "./engineV3_tui_settings.ts";
import { acquireTuiLock, prepareTuiStore, readTuiSettings, releaseTuiLock } from "./engineV3_tui_settings.ts";
import { forceResetStoreFolder, isFullBuildRepoInStore } from "../engineV3_step_store_guard.ts";
// import { clearTerminalScreen } from "./engineV3_tui_screen.ts";
import { enterAlternateScreen, leaveAlternateScreen } from "./engineV3_tui_screen.ts";
import { LegendFrame } from "./engineV3_tui_legend_frame.tsx";
import { StoreAnswer, StoreQuestion } from "./engineV3_tui_store_question.ts";
import { registerShutdownSignalHandlers, shutdownTui } from "./engineV3_tui_shutdown.ts";
import { createSpawnPlayProcess, createSpawnStepProcess, endAllLiveChildren, endChildOfFile } from "./engineV3_tui_step_process.ts";
import { createHistoryWalker } from "./engineV3_tui_walk.ts";
import { createWalkState, getFileRunState } from "./engineV3_tui_walk_state.ts";
import type { PlayRequest, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";
import { createResetHandlers, createStatusChangeWiring } from "./engineV3_tui_wiring.ts";

const tuiFolder = dirname(fileURLToPath(import.meta.url));
const jfredFolder = new Path(join(tuiFolder, "..", ".."));

async function main(): Promise<void> {
    const settings = readTuiSettings(process.argv.slice(2));
    const { projectFolder, storeFolder } = settings;
    // prepareTuiStore(storeFolder, projectFolder);
    acquireTuiLock(storeFolder);
    const keymap = loadKeymap(new Path(join(tuiFolder, "keymap.json")));
    // clearTerminalScreen(process.stdout);
    enterAlternateScreen(process.stdout);
    process.on("exit", () => leaveAlternateScreen(process.stdout));
    const instance = render(createLoadingScreen("files done 0 of ?"));
    await runProjectCacheChild(jfredFolder, (progressText) => instance.rerender(createLoadingScreen(progressText)));
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
        instance.rerender(createLoadingScreen("the store is reset: the load continues"));
    }
    // const staleFiles = listProjectFilesWithStaleInverseRepos(storeFolder, projectFolder, projectFiles, cache.transcriptsToParse, earliestBoundary);
    let staleRepoCount = listProjectFilesWithStaleInverseRepos(storeFolder, projectFolder, projectFiles, cache.transcriptsToParse, earliestBoundary).length;
    const refreshStaleRepoCount = (): void => {
        staleRepoCount = listProjectFilesWithStaleInverseRepos(storeFolder, projectFolder, projectFiles, cache.transcriptsToParse, earliestBoundary).length;
        appProps.staleRepoCount = staleRepoCount;
        instance.rerender(createElement(App, { ...appProps }));
    };
    const logFilesHashAtStart = getLogFilesHash(cache.transcriptsToParse);
    const spawnSettings = { projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder, earliestBoundary, jfredFolder };
    const walkState = createWalkState();
    const { handleStatusChange, clearRunStateOfFile, subscribeToStatusChanges } = createStatusChangeWiring(walkState);
    const consentAnswers: ConsentAnswers = { runScripts: undefined, runModifyingScriptsAutomatically: undefined };
    const consentGate = createConsentGate(consentAnswers, cache.scriptCounts);
    const readCoverageOfFile = (file: Path) => readWalkCoverage(getInverseRepoFolderForFile(storeFolder, projectFolder, file));
    const isFileWalkFinished = (file: Path) => readCoverageOfFile(file)?.isFinished === true;
    const listWalkToEndFiles = (file: Path) => cache.replayFiles.filter((replayFile) => !replayFile.equals(file));
    const pool = createStepPool({
        maxProcesses: settings.processes,
        spawnStepProcess: createSpawnStepProcess(spawnSettings),
        spawnPlayProcess: createSpawnPlayProcess(spawnSettings),
        onOutcome: (request: StepRequest, outcome: StepProcessOutcome) => void walker.handleOutcome(request, outcome),
        onStatusChange: handleStatusChange,
        isFileWalkFinished,
        isFileSteppable: (file) => cache.projectFiles.some((projectFile) => projectFile.toString() === file.toString()),
        hasLogsGrown: () => getLogFilesHash(cache.transcriptsToParse) !== logFilesHashAtStart,
        isStoreStale: () => staleRepoCount > 0,
        onLogsGrew: () => {
            appProps.cacheStatusText = "the logs grew: restart the TUI to see the new events";
            instance.rerender(createElement(App, { ...appProps }));
        },
        endChildOfFile,
        endAllChildren: endAllLiveChildren,
        // the pool starts no walk and no play until the consent questions are answered
        consentGate: consentGate.whenAnswered,
    });
    const walker = createHistoryWalker({
        storeFolder,
        projectFolder,
        walkState,
        requestWalk: pool.requestWalk,
        requestPlay: (request: PlayRequest) => pool.requestPlay(request, listWalkToEndFiles(request.file)),
        decideScriptAction: (file, eventType, source) => decideScriptAction(consentAnswers, { file, eventType, source }),
        onStatusChange: handleStatusChange,
        playKeyName: formatKeyBinding(keymap.get(TuiCommand.PlayScript)!),
    });
    registerShutdownSignalHandlers(pool, storeFolder);
    const resetHandlers = createResetHandlers({ storeFolder, projectFolder, pool, walkState, clearRunStateOfFile, refreshStaleRepoCount });
    const appProps: AppProps = {
        terminalRows: process.stdout.rows,
        terminalColumns: process.stdout.columns,
        projectFolder,
        storeFolder,
        files: cache.projectFiles,
        events: cache.events,
        countsByFile: cache.countsByFile,
        keymap,
        walkState,
        walker,
        pool,
        scriptCounts: cache.scriptCounts,
        consentAnswers,
        staleRepoCount,
        cacheStatusText: undefined,
        subscribeToStatusChanges,
        loadFileWire: (file) => listInverseRepoFileWire(storeFolder, projectFolder, file),
        isTimeSpannedForFile: (file, instant) => {
            const coverage = readCoverageOfFile(file);
            if (coverage === undefined) {
                return false;
            }
            return isInstantSpannedByWalkCoverage(coverage, instant);
        },
        onConsentAnswered: (answerKey, answer) => {
            consentAnswers[answerKey] = answer;
            consentGate.notifyAnswerGiven();
        },
        onResetSelectedStores: resetHandlers.resetSelectedStores,
        onResetAllStores: resetHandlers.resetAllStoresOfProject,
        // onPlayScript: (file) => pool.requestPlay({ file }, listWalkToEndFiles(file)),
        onPlayScript: (file, startAt) => walker.playScript(file, startAt),
    };
    instance.rerender(createElement(App, appProps));
    if (settings.isAuto) {
        if (cache.events.length === 0) {
            instance.unmount();
        } else {
            void runAutoWalk({ oldestInstant: new Date(0), files: cache.projectFiles, walker, pool, getRunState: (file) => getFileRunState(walkState, file), isFileWalkFinished, consentGate: consentGate.whenAnswered });
        }
    }
    await instance.waitUntilExit();
    await shutdownTui(pool, storeFolder);
    process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    // Leave the alternate screen first, so the error text stays on the normal screen.
    main().catch((error) => {
        leaveAlternateScreen(process.stdout);
        throw error;
    });
}
