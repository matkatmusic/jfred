// The TUI settings: flags, the start check on the store folder, and the one-TUI-per-store lock.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Path, Uuid } from "../../src/structures/domain.ts";
import { extractValueFlag } from "../../src/reconstruction_cli_flags.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../../src/viewer_api_layer1_inverse_repos.ts";
import { readInverseReposSettingsFromArguments, type ProjectFile } from "../engineV3_inverse_repos_for_project.ts";
import { assertStoreHasNoFullBuildRepos, assertStoreIsInsideCacheFolder } from "../engineV3_step_store_guard.ts";
import { getProjectCacheFile } from "./engineV3_tui_project_cache.ts";
import { registerLockFileForExit } from "./engineV3_tui_live_children.ts";

// const USAGE = "usage: node --import tsx engineV3/tui/engineV3_tui_main.tsx --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> [--repo <folder> --commit <commit>] [--processes <1-4>] [--auto]";
// const USAGE = "usage: node --import tsx engineV3/tui/jfredTUI.ts --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> [--repo <folder> --commit <commit>] [--processes <1-4>] [--auto]";
const USAGE = "usage: node --import tsx engineV3/tui/jfredTUI.ts --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> [--repo <folder> --commit <commit>] [--processes <1-4>] [--auto] | --settings <file.json>";
const SETTINGS_KEYS = ["project", "jsonls", "file-history", "store", "repo", "commit", "processes", "auto"];
const SETTINGS_LIST_KEYS = ["jsonls", "file-history"];
const DEFAULT_PROCESSES = 4;
const MAXIMUM_PROCESSES = 4;
const MINIMUM_PROCESSES = 1;

export type TuiSettings = {
    projectFolder: Path;
    jsonlsFolders: Path[];
    fileHistoryFolders: Path[];
    storeFolder: Path;
    repoFolder: Path | undefined;
    commit: Uuid | undefined;
    processes: number;
    isAuto: boolean;
};

function readProcessCountFlag(processesFlagValue: string | undefined): number {
    if (processesFlagValue === undefined) {
        return DEFAULT_PROCESSES;
    }
    const processes = Number(processesFlagValue);
    if (!Number.isInteger(processes)) {
        throw new Error(USAGE);
    }
    if (processes > MAXIMUM_PROCESSES) {
        throw new Error(USAGE);
    }
    if (processes < MINIMUM_PROCESSES) {
        throw new Error(USAGE);
    }
    return processes;
}

function readSettingsFileAsArguments(settingsFile: string): string[] {
    const settingsObject = JSON.parse(readFileSync(settingsFile, "utf8"));
    const argv: string[] = [];
    for (const [key, value] of Object.entries(settingsObject)) {
        if (!SETTINGS_KEYS.includes(key)) {
            throw new Error(USAGE);
        }
        if (key === "auto") {
            if (typeof value !== "boolean") {
                throw new Error(USAGE);
            }
            if (value) {
                argv.push("--auto");
            }
            continue;
        }
        if (SETTINGS_LIST_KEYS.includes(key)) {
            if (!Array.isArray(value)) {
                throw new Error(USAGE);
            }
            argv.push("--" + key, value.join(","));
            continue;
        }
        argv.push("--" + key, String(value));
    }
    return argv;
}

export function getFlagArguments(argv: string[]): string[] {
    if (!argv.includes("--settings")) {
        return argv;
    }
    const settingsFlag = extractValueFlag(argv, "--settings");
    if (settingsFlag.rest.length !== 0) {
        throw new Error(USAGE);
    }
    if (settingsFlag.value === undefined) {
        throw new Error(USAGE);
    }
    return readSettingsFileAsArguments(settingsFlag.value);
}

export function readTuiSettings(settingsOrFlagArguments: string[]): TuiSettings {
    const argv = getFlagArguments(settingsOrFlagArguments);
    const folderSettings = readInverseReposSettingsFromArguments(argv);
    const repoFlag = extractValueFlag(argv, "--repo");
    const commitFlag = extractValueFlag(argv, "--commit");
    const processesFlag = extractValueFlag(argv, "--processes");
    if (repoFlag.value !== undefined) {
        if (commitFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    if (commitFlag.value !== undefined) {
        if (repoFlag.value === undefined) {
            throw new Error(USAGE);
        }
    }
    let repoFolder: Path | undefined;
    if (repoFlag.value !== undefined) {
        repoFolder = new Path(repoFlag.value);
    }
    let commit: Uuid | undefined;
    if (commitFlag.value !== undefined) {
        commit = new Uuid(commitFlag.value);
    }
    const processes = readProcessCountFlag(processesFlag.value);
    const isAuto = argv.includes("--auto");
    return { projectFolder: folderSettings.projectFolder, jsonlsFolders: folderSettings.jsonlsFolders, fileHistoryFolders: folderSettings.fileHistoryFolders, storeFolder: folderSettings.storeFolder, repoFolder, commit, processes, isAuto };
}

// export function prepareTuiStore(storeFolder: Path, projectFolder: Path): void {
export function prepareTuiStore(storeFolder: Path, projectFolder: Path, projectFiles: ProjectFile[]): void {
    mkdirSync(storeFolder.toString(), { recursive: true });
    assertStoreIsInsideCacheFolder(storeFolder, new Path(INVERSE_REPOS_CACHE_FOLDER));
    // assertStoreHasNoFullBuildRepos(storeFolder, projectFolder, []);
    // assertStoreHasNoFullBuildRepos(storeFolder, projectFolder, projectFiles);
}

export function getTuiLockFile(storeFolder: Path): Path {
    return new Path(join(dirname(getProjectCacheFile(storeFolder).toString()), "tui.lock"));
}

export function acquireTuiLock(storeFolder: Path): void {
    const lockFile = getTuiLockFile(storeFolder);
    mkdirSync(dirname(lockFile.toString()), { recursive: true });
    if (existsSync(lockFile.toString())) {
        const lockedProcessId = readFileSync(lockFile.toString(), "utf8").trim();
        const processCheck = spawnSync("ps", ["-p", lockedProcessId]);
        if (processCheck.status === 0) {
            throw new Error(`acquireTuiLock: another TUI (process ${lockedProcessId}) already uses the store ${storeFolder.toString()}`);
        }
    }
    writeFileSync(lockFile.toString(), String(process.pid));
    registerLockFileForExit(lockFile);
}

export function releaseTuiLock(storeFolder: Path): void {
    rmSync(getTuiLockFile(storeFolder).toString(), { force: true });
}
