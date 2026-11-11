// A small index line per transcript line, in the same time order as loadMergedJSONLLines, so the engine never holds every full line.
// An index line keeps only what the sort rules and the collect steps read; the full line is read again from disk when it is needed.

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource, setRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";
import { parseRecord } from "../src/parse/parseRecord.ts";
import { getContentBlocks } from "../src/structures/content-blocks.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { mergeRecordsByTimestamp } from "../src/reconstruction_multi_source.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import type { JSONLLine } from "./engineV3.ts";
import { collectDelayedScriptCallTimes, dropCopiedTranscripts, loadFileRecords, parseUnknownTypeLine, printUnknownFields, printUnknownRecordTypes, type UnknownField } from "./engineV3_jsonl_lines.ts";
import { collectBashCallStarts } from "./engineV3_replay_bash_results.ts";
import { ignorePhaseProgress, type ReportPhaseProgress } from "./engineV3_startup_progress.ts";

export type JSONLLineIndex = { indexLines: JSONLLine[]; transcriptFileCount: number };
type LineByteRange = { byteOffset: number; byteLength: number };
type LineLocation = LineByteRange & { isUnknownType: boolean };

// The top-level fields the sort rules and the collect steps read; message and snapshot are kept in a smaller form.
const INDEX_LINE_FIELD_NAMES = ["type", "uuid", "parentUuid", "sessionId", "timestamp", "messageId", "isSnapshotUpdate"];
const NEWLINE_BYTE = 10;

const lineLocations = new WeakMap<JSONLLine, LineLocation>();

// Index i is line number i + 1, numbered like loadTranscript numbers them (split on "\n").
function findLineByteRanges(fileBytes: Buffer): LineByteRange[] {
  const ranges: LineByteRange[] = [];
  let lineStart = 0;
  while (true) {
    const newlineIndex = fileBytes.indexOf(NEWLINE_BYTE, lineStart);
    if (newlineIndex === -1) {
      ranges.push({ byteOffset: lineStart, byteLength: fileBytes.length - lineStart });
      return ranges;
    }
    ranges.push({ byteOffset: lineStart, byteLength: newlineIndex - lineStart });
    lineStart = newlineIndex + 1;
  }
}

// Only tool_use (id, name) and tool_result (tool_use_id, is_error, and the result text when asked) blocks are kept, as raw blocks.
function createIndexContent(rawContent: unknown[], keepResultContent: boolean): object[] {
  const indexContent: object[] = [];
  for (const rawBlock of rawContent as Record<string, unknown>[]) {
    if (rawBlock.type === BlockType.tool_use) {
      indexContent.push({ type: rawBlock.type, id: rawBlock.id, name: rawBlock.name });
    }
    if (rawBlock.type === BlockType.tool_result) {
      if (keepResultContent) {
        indexContent.push({ type: rawBlock.type, tool_use_id: rawBlock.tool_use_id, is_error: rawBlock.is_error, content: rawBlock.content });
      }
      else {
        indexContent.push({ type: rawBlock.type, tool_use_id: rawBlock.tool_use_id, is_error: rawBlock.is_error });
      }
    }
  }
  return indexContent;
}

// The collect steps read blocks only on lines with a timestamp; reading them here throws on an unknown block type, as those steps would.
function createIndexLine(record: JSONLLine, keepResultContent: boolean): JSONLLine {
  const recordFields = record as unknown as Record<string, unknown>;
  const indexFields: Record<string, unknown> = {};
  for (const fieldName of INDEX_LINE_FIELD_NAMES) {
    if (fieldName in recordFields) {
      indexFields[fieldName] = recordFields[fieldName];
    }
  }
  if (record.timestamp instanceof Date) {
    getContentBlocks(record);
    const message = recordFields.message as { content?: unknown } | undefined;
    if (message !== undefined) {
      if (Array.isArray(message.content)) {
        indexFields.message = { content: createIndexContent(message.content, keepResultContent) };
      }
    }
  }
  if (record.type === RecordType.fileHistorySnapshot) {
    const snapshot = recordFields.snapshot as { messageId: unknown; timestamp: unknown };
    indexFields.snapshot = { messageId: snapshot.messageId, timestamp: snapshot.timestamp, trackedFileBackups: {} };
  }
  // The index line is a smaller copy of a parsed line, so it keeps the parsed line's type.
  const indexLine = indexFields as unknown as JSONLLine;
  setRecordSource(indexLine, getRecordSource(record) as RecordSource);
  return indexLine;
}

function createFileIndexLines(transcriptFile: Path, records: JSONLLine[], unknownRecordTypes: Set<string>): JSONLLine[] {
  const ranges = findLineByteRanges(readFileSync(transcriptFile.toString()));
  const indexLines: JSONLLine[] = [];
  for (const record of records) {
    const indexLine = createIndexLine(record, false);
    const range = ranges[(getRecordSource(record) as RecordSource).lineNumber - 1] as LineByteRange;
    lineLocations.set(indexLine, { ...range, isUnknownType: unknownRecordTypes.has(String(record.type)) });
    indexLines.push(indexLine);
  }
  return indexLines;
}

function readLineText(filePath: string, location: LineLocation): string {
  const lineBytes = Buffer.alloc(location.byteLength);
  const fileHandle = openSync(filePath, "r");
  readSync(fileHandle, lineBytes, 0, location.byteLength, location.byteOffset);
  closeSync(fileHandle);
  return lineBytes.toString("utf8");
}

// The full line, parsed the way loadMergedJSONLLines parses it, with the same source file and line number.
export function readFullJSONLLine(indexLine: JSONLLine): JSONLLine {
  const location = lineLocations.get(indexLine);
  if (location === undefined) {
    throw new Error("readFullJSONLLine: the line is not an index line from loadJSONLLineIndex");
  }
  const source = getRecordSource(indexLine) as RecordSource;
  const lineText = readLineText(source.filePath, location);
  let fullLine: JSONLLine;
  if (location.isUnknownType) {
    fullLine = parseUnknownTypeLine(lineText);
  }
  else {
    fullLine = parseRecord(lineText);
  }
  setRecordSource(fullLine, source);
  return fullLine;
}

// The same keys, each mapped to its full line read from disk.
export function readFullResultLines(resultLines: Map<string, JSONLLine>): Map<string, JSONLLine> {
  const fullResultLines = new Map<string, JSONLLine>();
  for (const [callId, indexLine] of resultLines) {
    fullResultLines.set(callId, readFullJSONLLine(indexLine));
  }
  return fullResultLines;
}

function hasResultOfCall(indexLine: JSONLLine, callIds: Map<string, unknown>): boolean {
  for (const block of getContentBlocks(indexLine)) {
    if (block.type === BlockType.tool_result) {
      if (callIds.has(block.tool_use_id.toString())) {
        return true;
      }
    }
  }
  return false;
}

// collectBashCallResults needs the result text, so a line holding a Bash-type result is indexed again with its result text.
function addScriptResultTexts(indexLines: JSONLLine[]): void {
  const scriptCallStarts = collectBashCallStarts(indexLines);
  for (const [lineIndex, indexLine] of indexLines.entries()) {
    if (indexLine.timestamp instanceof Date) {
      if (hasResultOfCall(indexLine, scriptCallStarts)) {
        const lineWithText = createIndexLine(readFullJSONLLine(indexLine), true);
        lineLocations.set(lineWithText, lineLocations.get(indexLine) as LineLocation);
        indexLines[lineIndex] = lineWithText;
      }
    }
  }
}

function readJSONLLineIndex(jsonlFolders: string[], reportProgress: ReportPhaseProgress): JSONLLineIndex {
  const indexLists: JSONLLine[][] = [];
  const unknownFields: UnknownField[] = [];
  const seenFieldIds = new Set<string>();
  const unknownRecordTypes = new Set<string>();
  const transcriptFiles = dropCopiedTranscripts(listTranscriptFiles(jsonlFolders));
  for (const transcriptFile of transcriptFiles) {
    const records = loadFileRecords(transcriptFile, seenFieldIds, unknownFields, unknownRecordTypes);
    indexLists.push(createFileIndexLines(transcriptFile, records, unknownRecordTypes));
    reportProgress(indexLists.length, transcriptFiles.length);
  }
  const sortTimeOverrides = new Map<JSONLLine, number>();
  for (const indexList of indexLists) {
    collectDelayedScriptCallTimes(indexList, sortTimeOverrides);
  }
  printUnknownFields(unknownFields);
  printUnknownRecordTypes(unknownRecordTypes);
  const indexLines = mergeRecordsByTimestamp(indexLists, sortTimeOverrides);
  addScriptResultTexts(indexLines);
  return { indexLines, transcriptFileCount: transcriptFiles.length };
}

// The replay asks for the same folders twice: once at startup and once for the timeline.
const lineIndexByFolders = new Map<string, JSONLLineIndex>();
export function loadJSONLLineIndex(jsonlFolders: string[], reportProgress: ReportPhaseProgress = ignorePhaseProgress): JSONLLineIndex {
  const foldersKey = JSON.stringify(jsonlFolders);
  const memoizedIndex = lineIndexByFolders.get(foldersKey);
  if (memoizedIndex !== undefined) {
    return memoizedIndex;
  }
  const lineIndex = readJSONLLineIndex(jsonlFolders, reportProgress);
  lineIndexByFolders.set(foldersKey, lineIndex);
  return lineIndex;
}
