// Loads the transcript lines that name each of many files, reading every transcript from disk one time.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { setRecordSource } from "../src/parse/loadTranscript.ts";
import { parseRecord } from "../src/parse/parseRecord.ts";
import { mergeRecordsByTimestamp } from "../src/reconstruction_multi_source.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import type { JSONLLine } from "./engineV3.ts";
import { printProgress } from "./layeredSearch/layeredSearch_ripgrep_helpers.ts";
import { CWD_KEY_TEXT, KNOWN_RECORD_TYPE_SET, countNewlinesBefore, type LineSpan } from "./engineV3_replay_reverse.ts";

export const ERRORED_RESULT_KEY_TEXT = '"is_error":true';

function readTranscriptBytesFromDisk(transcriptFile: Path): Buffer {
    return readFileSync(transcriptFile.toString());
}

function getNeedleText(file: Path): string {
    return JSON.stringify(basename(file.toString())).slice(1, -1);
}

function escapeRegExpText(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLineSpanAroundInText(transcriptText: string, position: number): LineSpan {
    const start = transcriptText.lastIndexOf("\n", position) + 1;
    let end = transcriptText.indexOf("\n", position);
    if (end === -1) {
        end = transcriptText.length;
    }
    return { start, end };
}

// The first line holding a cwd is added to every non-empty list, because mapSourceFilesToCwd needs one per source file.
function addCwdSpanToNonEmptyLists(transcriptText: string, spansByNeedleText: Map<string, LineSpan[]>): void {
    const cwdPosition = transcriptText.indexOf(CWD_KEY_TEXT);
    if (cwdPosition !== -1) {
        const cwdSpan = findLineSpanAroundInText(transcriptText, cwdPosition);
        for (const spans of spansByNeedleText.values()) {
            if (spans.length > 0) {
                if (!spans.some((span) => span.start === cwdSpan.start)) {
                    spans.push(cwdSpan);
                    spans.sort((leftSpan, rightSpan) => leftSpan.start - rightSpan.start);
                }
            }
        }
    }
}

// Every line with an errored tool_result is added to every non-empty list, because an error result names no file and the walk must see which calls failed.
function addErroredResultSpansToNonEmptyLists(transcriptText: string, spansByNeedleText: Map<string, LineSpan[]>): void {
    const erroredResultSpans: LineSpan[] = [];
    let erroredResultPosition = transcriptText.indexOf(ERRORED_RESULT_KEY_TEXT);
    while (erroredResultPosition !== -1) {
        const erroredResultSpan = findLineSpanAroundInText(transcriptText, erroredResultPosition);
        erroredResultSpans.push(erroredResultSpan);
        erroredResultPosition = transcriptText.indexOf(ERRORED_RESULT_KEY_TEXT, erroredResultSpan.end + 1);
    }
    for (const spans of spansByNeedleText.values()) {
        if (spans.length > 0) {
            const knownStarts = new Set(spans.map((span) => span.start));
            for (const erroredResultSpan of erroredResultSpans) {
                if (!knownStarts.has(erroredResultSpan.start)) {
                    spans.push(erroredResultSpan);
                }
            }
            spans.sort((leftSpan, rightSpan) => leftSpan.start - rightSpan.start);
        }
    }
}

type NeedleTrieNode = { children: Map<string, NeedleTrieNode>; needleText: string | undefined };
function createNeedleTrie(needleTexts: string[], needleByteTexts: string[]): NeedleTrieNode {
    const root: NeedleTrieNode = { children: new Map(), needleText: undefined };
    for (const [needleIndex, needleByteText] of needleByteTexts.entries()) {
        let node = root;
        for (const character of needleByteText) {
            let child = node.children.get(character);
            if (child === undefined) {
                child = { children: new Map(), needleText: undefined };
                node.children.set(character, child);
            }
            node = child;
        }
        node.needleText = needleTexts[needleIndex];
    }
    return root;
}
// Every needle that starts at the position, including a needle that is the start of a longer needle.
function listNeedleTextsStartingAt(root: NeedleTrieNode, text: string, position: number, lineEnd: number): string[] {
    const needleTexts: string[] = [];
    let node = root;
    let index = position;
    while (index < lineEnd) {
        const child = node.children.get(text[index]!);
        if (child === undefined) {
            break;
        }
        node = child;
        if (node.needleText !== undefined) {
            needleTexts.push(node.needleText);
        }
        index += 1;
    }
    return needleTexts;
}
// A latin1 string has one char per byte, so a string index is a byte offset. One RegExp pass finds the lines holding any needle.
export function listLineSpansByNeedleText(transcriptBytes: Buffer, needleTexts: string[]): Map<string, LineSpan[]> {
    const transcriptText = transcriptBytes.toString("latin1");
    const needleByteTexts = needleTexts.map((needleText) => Buffer.from(needleText).toString("latin1"));
    const anyNeedleRegExp = new RegExp(needleByteTexts.map(escapeRegExpText).join("|"), "g");
    const spansByNeedleText = new Map<string, LineSpan[]>();
    for (const needleText of needleTexts) {
        spansByNeedleText.set(needleText, []);
    }
    const needleTrie = createNeedleTrie(needleTexts, needleByteTexts);
    let hit = anyNeedleRegExp.exec(transcriptText);
    while (hit !== null) {
        const span = findLineSpanAroundInText(transcriptText, hit.index);
        const needleTextsInLine = new Set<string>();
        let isHitInLine = true;
        while (isHitInLine) {
            for (const needleText of listNeedleTextsStartingAt(needleTrie, transcriptText, hit!.index, span.end)) {
                needleTextsInLine.add(needleText);
            }
            anyNeedleRegExp.lastIndex = hit!.index + 1;
            hit = anyNeedleRegExp.exec(transcriptText);
            isHitInLine = false;
            if (hit !== null) {
                if (hit.index < span.end) {
                    isHitInLine = true;
                }
            }
        }
        for (const needleText of needleTextsInLine) {
            spansByNeedleText.get(needleText)!.push(span);
        }
        // const lineText = transcriptText.slice(span.start, span.end);
        // for (const [needleIndex, needleText] of needleTexts.entries()) {
        //     if (lineText.includes(needleByteTexts[needleIndex]!)) {
        //         spansByNeedleText.get(needleText)!.push(span);
        //     }
        // }
        // anyNeedleRegExp.lastIndex = span.end + 1;
        // hit = anyNeedleRegExp.exec(transcriptText);
    }
    addCwdSpanToNonEmptyLists(transcriptText, spansByNeedleText);
    addErroredResultSpansToNonEmptyLists(transcriptText, spansByNeedleText);
    return spansByNeedleText;
}

// Counting newlines once over all starts, in order, costs one pass however many needles matched.
function listLineNumbersByStart(transcriptBytes: Buffer, spansByNeedleText: Map<string, LineSpan[]>): Map<number, number> {
    const startSet = new Set<number>();
    for (const spans of spansByNeedleText.values()) {
        for (const span of spans) {
            startSet.add(span.start);
        }
    }
    const sortedStarts = [...startSet].sort((leftStart, rightStart) => leftStart - rightStart);
    const lineNumberByStart = new Map<number, number>();
    let lineNumber = 1;
    let countedUpTo = 0;
    for (const start of sortedStarts) {
        lineNumber += countNewlinesBefore(transcriptBytes, countedUpTo, start);
        countedUpTo = start;
        lineNumberByStart.set(start, lineNumber);
    }
    return lineNumberByStart;
}

// Returns undefined for a line of an unknown record type.
export function parseRecordAtSpan(transcriptFile: Path, transcriptBytes: Buffer, span: LineSpan, lineNumber: number): JSONLLine | undefined {
    const lineText = transcriptBytes.toString("utf8", span.start, span.end);
    const recordType = (JSON.parse(lineText) as { type?: unknown }).type;
    if (KNOWN_RECORD_TYPE_SET.has(String(recordType))) {
        const record = parseRecord(lineText);
        setRecordSource(record, { filePath: transcriptFile.toString(), lineNumber });
        return record;
    }
    return undefined;
}

function listRecordsInSpans(transcriptFile: Path, transcriptBytes: Buffer, spans: LineSpan[], lineNumberByStart: Map<number, number>, recordByStart: Map<number, JSONLLine | undefined>): JSONLLine[] {
    const records: JSONLLine[] = [];
    for (const span of spans) {
        if (!recordByStart.has(span.start)) {
            recordByStart.set(span.start, parseRecordAtSpan(transcriptFile, transcriptBytes, span, lineNumberByStart.get(span.start)!));
        }
        const record = recordByStart.get(span.start);
        if (record !== undefined) {
            records.push(record);
        }
    }
    return records;
}

// A line is parsed once per transcript and its record is shared by every list that holds the line: no consumer mutates a record.
export function loadJSONLLinesNamingFiles(files: Path[], jsonlsFolders: Path[], readTranscriptBytes: (transcriptFile: Path) => Buffer = readTranscriptBytesFromDisk): Map<string, JSONLLine[]> {
    const needleTextByFileKey = new Map<string, string>();
    for (const file of files) {
        needleTextByFileKey.set(file.toString(), getNeedleText(file));
    }
    const distinctNeedleTexts = [...new Set(needleTextByFileKey.values())];
    const recordListsByFileKey = new Map<string, JSONLLine[][]>();
    for (const fileKey of needleTextByFileKey.keys()) {
        recordListsByFileKey.set(fileKey, []);
    }
    // for (const transcriptFile of listTranscriptFiles(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString()))) {
    const transcriptFiles = listTranscriptFiles(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString()));
    for (const [transcriptIndex, transcriptFile] of transcriptFiles.entries()) {
        const transcriptBytes = readTranscriptBytes(transcriptFile);
        const spansByNeedleText = listLineSpansByNeedleText(transcriptBytes, distinctNeedleTexts);
        const lineNumberByStart = listLineNumbersByStart(transcriptBytes, spansByNeedleText);
        const recordByStart = new Map<number, JSONLLine | undefined>();
        for (const [fileKey, needleText] of needleTextByFileKey) {
            const records = listRecordsInSpans(transcriptFile, transcriptBytes, spansByNeedleText.get(needleText)!, lineNumberByStart, recordByStart);
            if (records.length > 0) {
                recordListsByFileKey.get(fileKey)!.push(records);
            }
        }
        printProgress(`D: ${transcriptIndex + 1}/${transcriptFiles.length} logs scanned`);
    }
    process.stderr.write("\n");
    const linesByFileKey = new Map<string, JSONLLine[]>();
    for (const [fileKey, recordLists] of recordListsByFileKey) {
        linesByFileKey.set(fileKey, mergeRecordsByTimestamp(recordLists));
    }
    return linesByFileKey;
}
