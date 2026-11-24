// Command line entry of Layer 1: build the inverse-per-file-repo of one file, or of every file of the project file list, from the git beacons only.
// Commit 0 is the on-disk state of the file; then one commit per git beacon, newest first. No replay, no ranges. The store folder must be new.
// usage: node --import tsx engineV3/buildInverseRepoFromGitBeaconsMain.ts [--file <absolute path>] (--settings <file.json> | --project <folder> --jsonls <folder>[,...] --file-history <folder>[,...] --store <folder> --repo <folder> --commit <commit>)

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { Path } from "../src/structures/domain.ts";
import { readEarliestBoundary, readFileTextAtBoundary } from "./engineV3_earliest_boundary.ts";
import { StateMoment, createProvenState } from "./engineV3_file_known_states.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile } from "./engineV3_inverse_repos_for_project.ts";
import { FileEventType, createEvent } from "./engineV3_replay_reverse_events.ts";
import { readDiskText } from "./engineV3_replay_reverse.ts";
import { printProgress } from "./layeredSearch/layeredSearch_ripgrep_helpers.ts";
import { formatProgressBar } from "./printGitBeaconsMain.ts";
import { getGitBeacons } from "./tryToSolvePuzzle.ts";
import { getProjectCacheFile, loadOrBuildProjectCache } from "./tui/engineV3_tui_project_cache.ts";
import { readTuiSettings } from "./tui/engineV3_tui_settings.ts";

const FILE_FLAG = "--file";
const USAGE = "usage: node --import tsx engineV3/buildInverseRepoFromGitBeaconsMain.ts [--file <absolute path>] (--settings <file.json> | --project <folder> --jsonls <folder>[,...] --file-history <folder>[,...] --store <folder> --repo <folder> --commit <commit>)";

// Commit 0 is the on-disk state (absent when the file is not on disk); each git beacon follows, newest first, at positions 1, 2, 3, ...
export function buildInverseRepoFromGitBeacons(inverseRepoFolder: Path, gitRepo: Path, file: Path, diskNowInstant: Date): void {
    const diskText = readDiskText(file);
    let diskModifiedInstant: Date | undefined;
    if (diskText !== undefined) {
        diskModifiedInstant = statSync(file.toString()).mtime;
    }
    const diskNowEvent = createEvent(FileEventType.DiskNow, diskModifiedInstant, undefined, { bytes: diskText });
    const fileName = basename(file.toString());
    createInverseRepo(inverseRepoFolder, fileName, { state: createProvenState(diskNowEvent, StateMoment.AtEvent, diskText), position: 0 }, diskNowInstant);
    const beaconStates: OrderedKnownState[] = [];
    for (const [index, beacon] of getGitBeacons(gitRepo, file).entries()) {
        beaconStates.push({ state: createProvenState(beacon, StateMoment.AtEvent, beacon.bytes), position: index + 1 });
    }
    if (beaconStates.length > 0) {
        insertStatesIntoInverseRepo(inverseRepoFolder, fileName, beaconStates);
    }
}

function assertStoreFolderIsNew(storeFolder: Path): void {
    if (existsSync(storeFolder.toString())) {
        if (readdirSync(storeFolder.toString()).length > 0) {
            throw new Error(`assertStoreFolderIsNew: the store ${storeFolder.toString()} already holds files; give a new store folder`);
        }
    }
}

function formatInverseCommitLine(position: number, eventType: FileEventType, instant: Date | undefined, text: string | undefined): string {
    let instantText = "no-time";
    if (instant !== undefined) {
        instantText = instant.toISOString();
    }
    let sizeText = "absent";
    if (text !== undefined) {
        sizeText = `${Buffer.byteLength(text, "utf8")} bytes`;
    }
    return `  ${position} ${eventType} ${instantText} ${sizeText}`;
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
    assertStoreFolderIsNew(settings.storeFolder);
    const earliestBoundary = readEarliestBoundary(settings.repoFolder, settings.commit!);
    let files: Path[] = [];
    if (fileFlag.value !== undefined) {
        files = [new Path(fileFlag.value)];
    } else {
        const input = { projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, earliestBoundary };
        const projectCacheFile = getProjectCacheFile(settings.storeFolder);
        files = loadOrBuildProjectCache(input, projectCacheFile, (progress) => printProgress(`project cache ${progress.current}/${progress.total}`)).cache.projectFiles;
    }
    const diskNowInstant = new Date();
    for (const [index, file] of files.entries()) {
        if (files.length > 1) {
            printProgress(`inverse repos ${formatProgressBar(index + 1, files.length)}`);
        }
        console.log(file.toString());
        if (!readFileTextAtBoundary(earliestBoundary, file).isInsideRepo) {
            console.log("  outside the git repo, 0 commits");
            continue;
        }
        const inverseRepoFolder = getInverseRepoFolderForFile(settings.storeFolder, settings.projectFolder, file);
        buildInverseRepoFromGitBeacons(inverseRepoFolder, settings.repoFolder, file, diskNowInstant);
        const inverseCommits = listInverseCommits(inverseRepoFolder, basename(file.toString()));
        for (const inverseCommit of inverseCommits) {
            console.log(formatInverseCommitLine(inverseCommit.position, inverseCommit.eventType, inverseCommit.instant, inverseCommit.text));
        }
        console.log(`  ${inverseCommits.length} commits`);
    }
    if (files.length > 1) {
        process.stderr.write("\n");
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    main();
}
