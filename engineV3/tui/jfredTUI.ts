// The TUI start file: reads the flags, loads the project cache, builds the pool and walker, draws the Ink screen.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { Path } from "../../src/structures/domain.ts";
import { TuiCommand } from "../../src/structures/vocabulary.ts";
import { getInverseRepoFolderForFile, getLogFilesHash, listProjectFilesWithStaleInverseRepos } from "../engineV3_inverse_repos_for_project.ts";
import { readWalkCoverage } from "../engineV3_walk_coverage.ts";
import { App } from "./engineV3_tui_app.tsx";
import { createAppProps } from "./engineV3_tui_app_props.ts";
import type { AppProps } from "./engineV3_tui_app_types.ts";
import { runAutoWalk } from "./engineV3_tui_auto.ts";
import { createConsentGate, decideScriptAction, type ConsentAnswers } from "./engineV3_tui_consent.ts";
import { createEngineLog, getEngineLogFile, openFolderOfLogFile } from "./engineV3_tui_engine_log.ts";
import { formatKeyBinding } from "./engineV3_tui_keymap.ts";
import { createStepPool } from "./engineV3_tui_pool.ts";
// import { acquireTuiLock, prepareTuiStore, readTuiSettings } from "./engineV3_tui_settings.ts";
import { acquireTuiLock, readTuiSettings } from "./engineV3_tui_settings.ts";
import { registerShutdownSignalHandlers, shutdownTui } from "./engineV3_tui_shutdown.ts";
import { loadProjectForTui } from "./engineV3_tui_startup.ts";
import { createSpawnPlayProcess, createSpawnStepProcess, endAllLiveChildren, endChildOfFile } from "./engineV3_tui_step_process.ts";
import { createHistoryWalker } from "./engineV3_tui_walk.ts";
import { createWalkState, getFileRunState } from "./engineV3_tui_walk_state.ts";
import type { PlayRequest, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";
import { createResetHandlers, createStatusChangeWiring } from "./engineV3_tui_wiring.ts";
import { leaveAlternateScreen } from "./engineV3_tui_screen.ts";

const tuiFolder = dirname(fileURLToPath(import.meta.url));
const jfredFolder = new Path(join(tuiFolder, "..", ".."));

async function main(): Promise<void> {
    const settings = readTuiSettings(process.argv.slice(2));
    const { projectFolder, storeFolder } = settings;
    // prepareTuiStore(storeFolder, projectFolder);
    acquireTuiLock(storeFolder);
    const { instance, keymap, keyBoxes, cache, earliestBoundary, projectFiles } = await loadProjectForTui(settings, tuiFolder, jfredFolder);
    // const staleFiles = listProjectFilesWithStaleInverseRepos(storeFolder, projectFolder, projectFiles, cache.transcriptsToParse, earliestBoundary);
    let staleRepoCount = listProjectFilesWithStaleInverseRepos(storeFolder, projectFolder, projectFiles, cache.transcriptsToParse, earliestBoundary).length;
    const refreshStaleRepoCount = (): void => {
        staleRepoCount = listProjectFilesWithStaleInverseRepos(storeFolder, projectFolder, projectFiles, cache.transcriptsToParse, earliestBoundary).length;
        appProps.staleRepoCount = staleRepoCount;
        instance.rerender(createElement(App, { ...appProps }));
    };
    const logFilesHashAtStart = getLogFilesHash(cache.transcriptsToParse);
    const engineLogFile = getEngineLogFile(storeFolder);
    const engineLog = createEngineLog(engineLogFile);
    // const spawnSettings = { projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder, earliestBoundary, jfredFolder };
    const spawnSettings = { projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder, earliestBoundary, jfredFolder, engineLog };
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
        engineLog,
    });
    registerShutdownSignalHandlers(pool, storeFolder);
    const resetHandlers = createResetHandlers({ storeFolder, projectFolder, pool, walkState, clearRunStateOfFile, refreshStaleRepoCount });
    const appProps: AppProps = createAppProps({
        projectFolder,
        storeFolder,
        keymap,
        keyBoxes,
        engineLog,
        openLogFolder: () => openFolderOfLogFile(engineLogFile),
        walkState,
        walker,
        pool,
        consentAnswers,
        staleRepoCount,
        subscribeToStatusChanges,
        onResetSelectedStores: resetHandlers.resetSelectedStores,
        onResetAllStores: resetHandlers.resetAllStoresOfProject,
        cache,
        readCoverageOfFile,
        consentGate,
    });
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
