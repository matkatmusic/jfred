// Child entry that builds or loads the TUI project cache, reporting per-file progress as JSON lines on stderr.

import { pathToFileURL } from "node:url";
import { Path, Uuid } from "../../src/structures/domain.ts";
import { extractValueFlag } from "../../src/reconstruction_cli_flags.ts";
import { readEarliestBoundary, type EarliestBoundary } from "../engineV3_earliest_boundary.ts";
import { readInverseReposSettingsFromArguments } from "../engineV3_inverse_repos_for_project.ts";
import { getProjectCacheFile, loadOrBuildProjectCache, type FileProgress, type TuiInput } from "./engineV3_tui_project_cache.ts";

const USAGE = "usage: node --import tsx engineV3/tui/engineV3_tui_project_cache_main.ts --project <folder> --jsonls <folder>[,<folder>...] --file-history <folder>[,<folder>...] --store <folder> [--repo <folder> --commit <commit>]";

function reportFileProgress(progress: FileProgress): void {
    console.error(JSON.stringify({ file: progress.file.toString(), current: progress.current, total: progress.total }));
}

function readTuiInputFromArguments(argumentList: string[]): TuiInput {
    const repoFlag = extractValueFlag(argumentList, "--repo");
    const commitFlag = extractValueFlag(repoFlag.rest, "--commit");
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
    let earliestBoundary: EarliestBoundary | undefined;
    if (repoFlag.value !== undefined) {
        earliestBoundary = readEarliestBoundary(new Path(repoFlag.value), new Uuid(commitFlag.value!));
    }
    const settings = readInverseReposSettingsFromArguments(commitFlag.rest);
    return { projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, earliestBoundary };
}

function main(): void {
    const input = readTuiInputFromArguments(process.argv.slice(2));
    const cacheFile = getProjectCacheFile(input.storeFolder);
    const { wasRebuilt } = loadOrBuildProjectCache(input, cacheFile, reportFileProgress);
    console.log(JSON.stringify({ cacheFile: cacheFile.toString(), wasRebuilt }));
    process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    main();
}
