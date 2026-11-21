// Command line entry of the jot run: solve the progress bar puzzle of every file named in the logs, or with --check-solved re-solve the solved files.
// usage: node --import tsx engineV3/solveAllProgressBarPuzzlesMain.ts [--check-solved] (--settings <file.json> | --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> --repo <folder> --commit <commit>)

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { readEarliestBoundary } from "./engineV3_earliest_boundary.ts";
import { isHistoryCompleteInGit, tryToReconstructAllFiles } from "./solveAllProgressBarPuzzles.ts";
import { tryToSolveProgressBarPuzzle } from "./tryToSolvePuzzle.ts";
import { readTuiSettings } from "./tui/engineV3_tui_settings.ts";
import { getProjectCacheFile, loadOrBuildProjectCache } from "./tui/engineV3_tui_project_cache.ts";

const CHECK_SOLVED_FLAG = "--check-solved";
const USAGE = "usage: node --import tsx engineV3/solveAllProgressBarPuzzlesMain.ts [--check-solved] (--settings <file.json> | --project <folder> --jsonls <folder>[,...] --file-history <folder>[,...] --store <folder> --repo <folder> --commit <commit>)";

function main(): void {
    const argumentList = process.argv.slice(2);
    const isCheckSolved = argumentList.includes(CHECK_SOLVED_FLAG);
    const settings = readTuiSettings(argumentList.filter((argument) => argument !== CHECK_SOLVED_FLAG));
    if (settings.repoFolder === undefined) {
        throw new Error(USAGE);
    }
    const earliestBoundary = readEarliestBoundary(settings.repoFolder, settings.commit!);
    const input = { projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, earliestBoundary };
    // The project cache holds the files the logs name; a check run reads only the reconstruction cache.
    let allFiles: Path[] = [];
    let filesWithHistoryCompleteInGit: Path[] = [];
    if (!isCheckSolved) {
        const projectCacheFile = getProjectCacheFile(settings.storeFolder);
        const projectCache = loadOrBuildProjectCache(input, projectCacheFile, (progress) => console.error(`project cache ${progress.current}/${progress.total} ${progress.file.toString()}`)).cache;
        allFiles = projectCache.projectFiles;
        const latestEventInstantByFile = new Map<string, Date>();
        for (const event of projectCache.events) {
            const latestInstant = latestEventInstantByFile.get(event.file.toString());
            if (latestInstant === undefined || latestInstant.getTime() < event.instant.getTime()) {
                latestEventInstantByFile.set(event.file.toString(), event.instant);
            }
        }
        filesWithHistoryCompleteInGit = allFiles.filter((file) => isHistoryCompleteInGit(settings.repoFolder!, file, latestEventInstantByFile.get(file.toString())));
    }
    const cliArgs = {
        allJSONLs: settings.jsonlsFolders,
        snapshotFolders: settings.fileHistoryFolders,
        allFiles,
        filesWithHistoryCompleteInGit,
        gitRepo: settings.repoFolder,
        gitHash: settings.commit!.toString(),
        cacheFile: new Path(join(settings.storeFolder.toString(), "reconstruction-cache.json")),
        isCheckSolved,
    };
    const startMilliseconds = Date.now();
    const cache = tryToReconstructAllFiles(cliArgs, tryToSolveProgressBarPuzzle, (line) => console.log(line));
    console.log(JSON.stringify({ fullyReconstructibleFiles: cache.fullyReconstructibleFiles.length, requiresFurtherResearchFiles: cache.requiresFurtherResearchFiles.length, filesNotOnDiskNow: cache.filesNotOnDiskNow.length, filesWithHistoryCompleteInGit: cache.filesWithHistoryCompleteInGit.length, seconds: (Date.now() - startMilliseconds) / 1000, cacheFile: cliArgs.cacheFile.toString() }));
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    main();
}
