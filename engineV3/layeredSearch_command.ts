// The command-line parameters of the layered search.

import { join } from "node:path";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { Path } from "../src/structures/domain.ts";

const USAGE = "usage: node layeredSearch.ts --repo <path> --jsonls <folder> --project <path> [--out <file>] [--include-outside-project] [--rg-mode per-path|all-paths]";
const DEFAULT_OUTPUT_FILE = join(import.meta.dirname, "..", ".cache", "layeredSearch", "files.json");

export enum RipgrepSearchMode { PerPath = "per-path", AllPaths = "all-paths" }

export type LayeredSearchCommand = {
    repoFolder: Path;
    jsonlsFolder: Path;
    projectFolder: Path;
    outputFile: Path;
    isOutsideProjectIncluded: boolean;
    ripgrepSearchMode: RipgrepSearchMode;
};

function readRequiredValueFlag(argumentList: string[], flag: string): { value: string; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    return { value, rest };
}

function readRipgrepSearchMode(modeText: string | undefined): RipgrepSearchMode {
    if (modeText === undefined) {
        return RipgrepSearchMode.AllPaths;
    }
    if (modeText === RipgrepSearchMode.PerPath) {
        return RipgrepSearchMode.PerPath;
    }
    if (modeText === RipgrepSearchMode.AllPaths) {
        return RipgrepSearchMode.AllPaths;
    }
    throw new Error(USAGE);
}

export function readLayeredSearchCommandFromArguments(argumentList: string[]): LayeredSearchCommand {
    const repoFlag = readRequiredValueFlag(argumentList, "--repo");
    const jsonlsFlag = readRequiredValueFlag(repoFlag.rest, "--jsonls");
    const projectFlag = readRequiredValueFlag(jsonlsFlag.rest, "--project");
    const outFlag = extractValueFlag(projectFlag.rest, "--out");
    const ripgrepModeFlag = extractValueFlag(outFlag.rest, "--rg-mode");
    return {
        repoFolder: new Path(repoFlag.value),
        jsonlsFolder: new Path(jsonlsFlag.value),
        projectFolder: new Path(projectFlag.value),
        outputFile: new Path(outFlag.value ?? DEFAULT_OUTPUT_FILE),
        isOutsideProjectIncluded: argumentList.includes("--include-outside-project"),
        ripgrepSearchMode: readRipgrepSearchMode(ripgrepModeFlag.value),
    };
}
