// The line source index: for each project file, the log lines that name it (scripts included), in final order.
// The terminal UI writes it beside the project cache; a step child reads only those lines instead of scanning every log.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getRecordSource } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import type { JSONLLine } from "./engineV3.ts";
import { parseRecordAtSpan } from "./engineV3_jsonl_lines_naming_files.ts";

const NEWLINE_BYTE = 10;
const LINE_SOURCE_INDEX_FILE_NAME = "lines-index.json";

// refsByFile holds flat pairs per file: transcript index, line number, transcript index, line number, ...
export type LineSourceIndex = { transcriptFiles: string[]; refsByFile: Record<string, number[]> };

export function getLineSourceIndexFile(projectCacheFile: Path): Path {
    return new Path(join(dirname(projectCacheFile.toString()), LINE_SOURCE_INDEX_FILE_NAME));
}
export function buildLineSourceIndex(linesByFileKey: Map<string, JSONLLine[]>): LineSourceIndex {
    const transcriptFiles: string[] = [];
    const transcriptIndexByFile = new Map<string, number>();
    const refsByFile: Record<string, number[]> = {};
    for (const [fileKey, lines] of linesByFileKey) {
        const refs: number[] = [];
        for (const line of lines) {
            const source = getRecordSource(line)!;
            let transcriptIndex = transcriptIndexByFile.get(source.filePath);
            if (transcriptIndex === undefined) {
                transcriptIndex = transcriptFiles.length;
                transcriptFiles.push(source.filePath);
                transcriptIndexByFile.set(source.filePath, transcriptIndex);
            }
            refs.push(transcriptIndex, source.lineNumber);
        }
        refsByFile[fileKey] = refs;
    }
    return { transcriptFiles, refsByFile };
}
export function writeLineSourceIndex(indexFile: Path, index: LineSourceIndex): void {
    const temporaryFile = `${indexFile.toString()}.tmp`;
    mkdirSync(dirname(indexFile.toString()), { recursive: true });
    writeFileSync(temporaryFile, JSON.stringify(index));
    renameSync(temporaryFile, indexFile.toString());
}
export function readLineSourceIndex(indexFile: Path): LineSourceIndex {
    return JSON.parse(readFileSync(indexFile.toString(), "utf8")) as LineSourceIndex;
}
function listLineNumbersByTranscriptIndex(refs: number[]): Map<number, Set<number>> {
    const lineNumbersByTranscriptIndex = new Map<number, Set<number>>();
    for (let refIndex = 0; refIndex < refs.length; refIndex += 2) {
        const transcriptIndex = refs[refIndex]!;
        if (!lineNumbersByTranscriptIndex.has(transcriptIndex)) {
            lineNumbersByTranscriptIndex.set(transcriptIndex, new Set<number>());
        }
        lineNumbersByTranscriptIndex.get(transcriptIndex)!.add(refs[refIndex + 1]!);
    }
    return lineNumbersByTranscriptIndex;
}
function parseWantedLinesOfTranscript(transcriptFile: Path, wantedLineNumbers: Set<number>, recordByRefKey: Map<string, JSONLLine>, transcriptIndex: number): void {
    const transcriptBytes = readFileSync(transcriptFile.toString());
    let lineNumber = 1;
    let start = 0;
    while (start < transcriptBytes.length) {
        let end = transcriptBytes.indexOf(NEWLINE_BYTE, start);
        if (end === -1) {
            end = transcriptBytes.length;
        }
        if (wantedLineNumbers.has(lineNumber)) {
            const record = parseRecordAtSpan(transcriptFile, transcriptBytes, { start, end }, lineNumber);
            if (record === undefined) {
                throw new Error(`${transcriptFile.toString()}:${lineNumber}: the index names a line of an unknown record type`);
            }
            recordByRefKey.set(`${transcriptIndex}:${lineNumber}`, record);
        }
        lineNumber += 1;
        start = end + 1;
    }
}
export function listLinesOfFileFromIndex(index: LineSourceIndex, fileKey: string): JSONLLine[] {
    const refs = index.refsByFile[fileKey];
    if (refs === undefined) {
        throw new Error(`${fileKey}: the line source index has no entry for this file`);
    }
    const recordByRefKey = new Map<string, JSONLLine>();
    for (const [transcriptIndex, wantedLineNumbers] of listLineNumbersByTranscriptIndex(refs)) {
        parseWantedLinesOfTranscript(new Path(index.transcriptFiles[transcriptIndex]!), wantedLineNumbers, recordByRefKey, transcriptIndex);
    }
    const lines: JSONLLine[] = [];
    for (let refIndex = 0; refIndex < refs.length; refIndex += 2) {
        const refKey = `${refs[refIndex]}:${refs[refIndex + 1]}`;
        const record = recordByRefKey.get(refKey);
        if (record === undefined) {
            throw new Error(`${fileKey}: the log line ${refKey} is not in the log any more`);
        }
        lines.push(record);
    }
    return lines;
}
