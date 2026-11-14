// Lists the files of a project: the files on disk now, then the files the logs name that are gone now.

import { existsSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isPathAlwaysExcluded, listCurrentFileState } from "../src/layer1_disk_walk.ts";
import { isPathIgnored, readIgnoreRules, type IgnoreRule } from "../src/layer1_ignore_rules.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { listEventPaths } from "../src/reconstruction_bound.ts";
import { extractFileEvents } from "../src/reconstruction_extract.ts";
import { Path } from "../src/structures/domain.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import type { ProjectFile } from "./engineV3_inverse_repos_for_project.ts";

// The same rule as the disk listing: always-excluded folder names, then the top-level .gitignore on each folder and on the file.
function isPathSkippedByDiskListing(relativePath: string, ignoreRules: IgnoreRule[]): boolean {
    if (isPathAlwaysExcluded(relativePath)) {
        return true;
    }
    const segments = relativePath.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
        if (isPathIgnored(segments.slice(0, depth).join("/"), true, ignoreRules)) {
            return true;
        }
    }
    return isPathIgnored(relativePath, false, ignoreRules);
}

// The callers use the path on disk as the path of the logs.
function makeProjectFile(file: Path): ProjectFile {
    return { file, transcriptFile: file };
}

export function listProjectFilesOnDiskAndInLogs(projectFolder: Path, jsonlsFolders: Path[]): ProjectFile[] {
    const filesOnDisk = listCurrentFileState(projectFolder).map((fileState) => new Path(join(projectFolder.toString(), fileState.relativePath.toString())));
    const listedPathTexts = new Set(filesOnDisk.map((file) => file.toString()));
    const ignoreRules = readIgnoreRules(projectFolder);
    const goneFileTexts = new Set<string>();
    for (const transcriptFile of listTranscriptFiles(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString()))) {
        const records = loadTranscript(transcriptFile.toString(), undefined, true).records;
        for (const event of extractFileEvents(records)) {
            for (const eventPath of listEventPaths(event)) {
                // A relative path in a remove or copy command has no cwd here, so it cannot be placed in the project.
                if (isAbsolute(eventPath.toString())) {
                    const relativePath = relative(projectFolder.toString(), eventPath.toString());
                    if (relativePath.split(sep)[0] !== "..") {
                        if (relativePath !== "") {
                            const fileText = join(projectFolder.toString(), relativePath);
                            if (!listedPathTexts.has(fileText)) {
                                if (!existsSync(fileText)) {
                                    if (!isPathSkippedByDiskListing(relativePath, ignoreRules)) {
                                        goneFileTexts.add(fileText);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    const goneFiles = [...goneFileTexts].sort().map((fileText) => new Path(fileText));
    return [...filesOnDisk, ...goneFiles].map(makeProjectFile);
}
