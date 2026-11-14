// Adds the run lines of written scripts to a file's line list: the line `python3 move_files.py` reaches the events of the file the script names.

import { basename } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { mergeRecordsByTimestamp } from "../src/reconstruction_multi_source.ts";
import { collectWrittenContentByBasename, isScriptFile } from "../src/reconstruction_script_indirection.ts";
import type { JSONLLine } from "./engineV3.ts";
import { loadJSONLLinesNamingFiles } from "./engineV3_jsonl_lines_naming_files.ts";

function getLineSourceKey(line: JSONLLine): string {
    const source = getRecordSource(line)!;
    return `${source.filePath}:${source.lineNumber}`;
}

function listScriptBaseNamesNamingFile(file: Path, lines: JSONLLine[]): string[] {
    const fileBaseName = basename(file.toString());
    const scriptBaseNames: string[] = [];
    for (const [writtenBaseName, bodies] of collectWrittenContentByBasename(lines)) {
        if (isScriptFile(writtenBaseName)) {
            if (bodies.some((body) => body.content?.includes(fileBaseName))) {
                scriptBaseNames.push(writtenBaseName);
            }
        }
    }
    return scriptBaseNames;
}

export function addLinesNamingWrittenScripts(linesByFileKey: Map<string, JSONLLine[]>, files: Path[], jsonlsFolders: Path[], readTranscriptBytes?: (transcriptFile: Path) => Buffer): void {
    const scriptBaseNamesByFileKey = new Map<string, string[]>();
    const allScriptBaseNames = new Set<string>();
    for (const file of files) {
        const fileKey = file.toString();
        const scriptBaseNames = listScriptBaseNamesNamingFile(file, linesByFileKey.get(fileKey) ?? []);
        scriptBaseNamesByFileKey.set(fileKey, scriptBaseNames);
        for (const scriptBaseName of scriptBaseNames) {
            allScriptBaseNames.add(scriptBaseName);
        }
    }
    if (allScriptBaseNames.size === 0) {
        return;
    }
    const scriptLinesByBaseName = loadJSONLLinesNamingFiles([...allScriptBaseNames].map((scriptBaseName) => new Path(scriptBaseName)), jsonlsFolders, readTranscriptBytes);
    for (const [fileKey, scriptBaseNames] of scriptBaseNamesByFileKey) {
        const existingLines = linesByFileKey.get(fileKey) ?? [];
        const knownSourceKeys = new Set(existingLines.map(getLineSourceKey));
        const addedLineLists: JSONLLine[][] = [];
        let addedLineCount = 0;
        for (const scriptBaseName of scriptBaseNames) {
            const addedLines: JSONLLine[] = [];
            for (const scriptLine of scriptLinesByBaseName.get(scriptBaseName)!) {
                const sourceKey = getLineSourceKey(scriptLine);
                if (!knownSourceKeys.has(sourceKey)) {
                    knownSourceKeys.add(sourceKey);
                    addedLines.push(scriptLine);
                }
            }
            addedLineCount += addedLines.length;
            addedLineLists.push(addedLines);
        }
        if (addedLineCount > 0) {
            linesByFileKey.set(fileKey, mergeRecordsByTimestamp([existingLines, ...addedLineLists]));
        }
    }
}
