// The command-line parameters of the layered search.

import { join } from "node:path";
import { extractValueFlag } from "../../src/reconstruction_cli_flags.ts";
import { Path } from "../../src/structures/domain.ts";

const USAGE = "usage: node layeredSearch.ts --repo <path> --jsonls <folder> [--jsonls <folder> ...] --project <path> [--out <file>] [--include-outside-project]";
const DEFAULT_OUTPUT_FILE = join(import.meta.dirname, "..", "..", ".cache", "layeredSearch", "files.json");

// export enum RipgrepSearchMode { PerPath = "per-path", AllPaths = "all-paths" }

export type LayeredSearchCommand = {
    repoFolder: Path;
    jsonlsFolders: Path[];
    projectFolder: Path;
    outputFile: Path;
    isOutsideProjectIncluded: boolean;
    // ripgrepSearchMode: RipgrepSearchMode;
};

function readRequiredValueFlag(argumentList: string[], flag: string): { value: string; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    return { value, rest };
}

function readRequiredRepeatedValueFlag(argumentList: string[], flag: string): { values: string[]; rest: string[] } {
    const values: string[] = [];
    let rest = argumentList;
    let flagResult = extractValueFlag(rest, flag);
    while (flagResult.value !== undefined) {
        values.push(flagResult.value);
        rest = flagResult.rest;
        flagResult = extractValueFlag(rest, flag);
    }
    if (values.length === 0) {
        throw new Error(USAGE);
    }
    return { values, rest };
}

// function readRipgrepSearchMode(modeText: string | undefined): RipgrepSearchMode {
//     if (modeText === undefined) {
//         return RipgrepSearchMode.AllPaths;
//     }
//     if (modeText === RipgrepSearchMode.PerPath) {
//         return RipgrepSearchMode.PerPath;
//     }
//     if (modeText === RipgrepSearchMode.AllPaths) {
//         return RipgrepSearchMode.AllPaths;
//     }
//     throw new Error(USAGE);
// }

function createPathFromText(text: string): Path {
    return new Path(text);
}

export function readLayeredSearchCommandFromArguments(argumentList: string[]): LayeredSearchCommand {
    const repoFlag = readRequiredValueFlag(argumentList, "--repo");
    const jsonlsFlag = readRequiredRepeatedValueFlag(repoFlag.rest, "--jsonls");
    const projectFlag = readRequiredValueFlag(jsonlsFlag.rest, "--project");
    const outFlag = extractValueFlag(projectFlag.rest, "--out");
    // const ripgrepModeFlag = extractValueFlag(outFlag.rest, "--rg-mode");
    return {
        repoFolder: new Path(repoFlag.value),
        jsonlsFolders: jsonlsFlag.values.map(createPathFromText),
        projectFolder: new Path(projectFlag.value),
        outputFile: new Path(outFlag.value ?? DEFAULT_OUTPUT_FILE),
        isOutsideProjectIncluded: argumentList.includes("--include-outside-project"),
        // ripgrepSearchMode: readRipgrepSearchMode(ripgrepModeFlag.value),
    };
}
