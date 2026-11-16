// Layered search, step 1: list the files of the project folder and write the list to a JSON file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listCurrentFileState } from "../src/layer1_disk_walk.ts";
import { extractValueFlag } from "../src/reconstruction_cli_flags.ts";
import { Path } from "../src/structures/domain.ts";

const USAGE = "usage: node layeredSearch.ts --repo <path> --jsonls <folder> --project <path> [--out <file>]";
const DEFAULT_OUTPUT_FILE = join(import.meta.dirname, "..", ".cache", "layeredSearch", "files.json");

type LayeredSearchCommand = {
    repoFolder: Path;
    jsonlsFolder: Path;
    projectFolder: Path;
    outputFile: Path;
};

function readRequiredValueFlag(argumentList: string[], flag: string): { value: string; rest: string[] } {
    const { value, rest } = extractValueFlag(argumentList, flag);
    if (value === undefined) {
        throw new Error(USAGE);
    }
    return { value, rest };
}

function readLayeredSearchCommandFromArguments(argumentList: string[]): LayeredSearchCommand {
    const repoFlag = readRequiredValueFlag(argumentList, "--repo");
    const jsonlsFlag = readRequiredValueFlag(repoFlag.rest, "--jsonls");
    const projectFlag = readRequiredValueFlag(jsonlsFlag.rest, "--project");
    const outFlag = extractValueFlag(projectFlag.rest, "--out");
    return {
        repoFolder: new Path(repoFlag.value),
        jsonlsFolder: new Path(jsonlsFlag.value),
        projectFolder: new Path(projectFlag.value),
        outputFile: new Path(outFlag.value ?? DEFAULT_OUTPUT_FILE),
    };
}

function listProjectFilePaths(projectFolder: Path): string[] {
    return listCurrentFileState(projectFolder).map((fileState) => fileState.relativePath.toString());
}

function writeJsonFile(outputFile: Path, content: object): void {
    mkdirSync(dirname(outputFile.toString()), { recursive: true });
    writeFileSync(outputFile.toString(), JSON.stringify(content, null, 2) + "\n");
}

export function main(argumentList: string[]): void {
    const command = readLayeredSearchCommandFromArguments(argumentList);
    const startTime = new Date();
    const files = listProjectFilePaths(command.projectFolder);
    const endTime = new Date();
    const elapsedMilliseconds = endTime.getTime() - startTime.getTime();
    writeJsonFile(command.outputFile, {
        repoFolder: command.repoFolder.toString(),
        jsonlsFolder: command.jsonlsFolder.toString(),
        projectFolder: command.projectFolder.toString(),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        elapsedMilliseconds,
        fileCount: files.length,
        files,
    });
    console.log(`startTime: ${startTime.toISOString()}`);
    console.log(`endTime: ${endTime.toISOString()}`);
    console.log(`elapsedMilliseconds: ${elapsedMilliseconds}`);
    console.log(`fileCount: ${files.length}`);
    console.log(`jsonFile: "${command.outputFile.toString()}"`);
}

const isCliRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliRun) {
    main(process.argv.slice(2));
}
