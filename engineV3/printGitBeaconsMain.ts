// Command line entry of Layer 1: print the git beacons of one file, or of every file of the project file list, newest first.
// usage: node --import tsx engineV3/printGitBeaconsMain.ts [--file <absolute path>] (--settings <file.json> | --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> --repo <folder> --commit <commit>)

import { pathToFileURL } from "node:url";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { Path } from "../src/structures/domain.ts";
import { readEarliestBoundary, readFileTextAtBoundary, type EarliestBoundary } from "./engineV3_earliest_boundary.ts";
import { printProgress } from "./layeredSearch/layeredSearch_ripgrep_helpers.ts";
import type { FileEvent } from "./engineV3_replay_reverse_events.ts";
import { getGitBeacons } from "./tryToSolvePuzzle.ts";
import { getProjectCacheFile, loadOrBuildProjectCache } from "./tui/engineV3_tui_project_cache.ts";
import { readTuiSettings } from "./tui/engineV3_tui_settings.ts";

const FILE_FLAG = "--file";
const SHORT_COMMIT_HASH_LENGTH = 10;
const PROGRESS_BAR_WIDTH = 30;
const USAGE = "usage: node --import tsx engineV3/printGitBeaconsMain.ts [--file <absolute path>] (--settings <file.json> | --project <folder> --jsonls <folder>[,...] --file-history <folder>[,...] --store <folder> --repo <folder> --commit <commit>)";

export function formatGitBeaconLine(beacon: FileEvent): string {
    const shortCommitHash = beacon.commitHash!.toString().slice(0, SHORT_COMMIT_HASH_LENGTH);
    let sizeText = "absent";
    if (beacon.bytes !== undefined) {
        sizeText = `${Buffer.byteLength(beacon.bytes, "utf8")} bytes`;
    }
    return `  ${shortCommitHash} ${beacon.instant!.toISOString()} ${sizeText}`;
}

export function formatProgressBar(current: number, total: number): string {
    const filledWidth = Math.floor((current / total) * PROGRESS_BAR_WIDTH);
    return `[${"#".repeat(filledWidth)}${"-".repeat(PROGRESS_BAR_WIDTH - filledWidth)}] ${current}/${total}`;
}

function printGitBeaconsOfFile(repoFolder: Path, earliestBoundary: EarliestBoundary, file: Path): void {
    console.log(file.toString());
    if (!readFileTextAtBoundary(earliestBoundary, file).isInsideRepo) {
        console.log("  outside the git repo, 0 beacons");
        return;
    }
    const beacons = getGitBeacons(repoFolder, file);
    for (const beacon of beacons) {
        console.log(formatGitBeaconLine(beacon));
    }
    console.log(`  ${beacons.length} beacons`);
}

function main(): void {
    const argumentList = process.argv.slice(2);
    const fileFlag = extractValueFlag(argumentList, FILE_FLAG);
    if (argumentList.includes(FILE_FLAG)) {
        if (fileFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    const settings = readTuiSettings(fileFlag.rest);
    if (settings.repoFolder === undefined) {
        throw new Error(USAGE);
    }
    const earliestBoundary = readEarliestBoundary(settings.repoFolder, settings.commit!);
    let files: Path[] = [];
    if (fileFlag.value !== undefined) {
        files = [new Path(fileFlag.value)];
    } else {
        const input = { projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, earliestBoundary };
        const projectCacheFile = getProjectCacheFile(settings.storeFolder);
        files = loadOrBuildProjectCache(input, projectCacheFile, (progress) => printProgress(`project cache ${progress.current}/${progress.total}`)).cache.projectFiles;
    }
    for (const [index, file] of files.entries()) {
        if (files.length > 1) {
            printProgress(`git beacons ${formatProgressBar(index + 1, files.length)}`);
        }
        printGitBeaconsOfFile(settings.repoFolder, earliestBoundary, file);
    }
    if (files.length > 1) {
        process.stderr.write("\n");
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    main();
}
