// Loads every transcript line under the JSONL folders as one time-ordered list.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource, loadTranscript, setRecordSource, type RecordSource, type SkippedLine } from "../src/parse/loadTranscript.ts";
import { findUnmodeledTopLevelKeys } from "../src/parse/recordKeys.ts";
import { mergeRecordsByTimestamp } from "../src/reconstruction_multi_source.ts";
import { readCommitTimestamp } from "../src/reconstruction_base_commit_evidence.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { getContentBlocks } from "../src/structures/content-blocks.ts";
import { BlockType, ToolName } from "../src/structures/vocabulary.ts";
import type { CommitHash, JSONLLine } from "./engineV3.ts";
import { ignorePhaseProgress, type ReportPhaseProgress } from "./engineV3_startup_progress.ts";

export type UnknownField = { recordType: string; fieldName: string };
export type MergedJSONLLines = { jsonlLines: JSONLLine[]; unknownFields: UnknownField[]; unknownRecordTypes: string[]; transcriptFileCount: number };

// Each (record type, field) pair is added once.
function collectUnknownFields(records: JSONLLine[], seenFieldIds: Set<string>, unknownFields: UnknownField[]): void {
  for (const record of records) {
    for (const fieldName of findUnmodeledTopLevelKeys(record)) {
      const fieldId = `${record.type}.${fieldName}`;
      const isNewField = !seenFieldIds.has(fieldId);
      if (isNewField) {
        seenFieldIds.add(fieldId);
        unknownFields.push({ recordType: record.type, fieldName });
      }
    }
  }
}

export function printUnknownFields(unknownFields: UnknownField[]): void {
  for (const unknownField of unknownFields) {
    console.log(`unknown field: ${unknownField.recordType}.${unknownField.fieldName}`);
  }
}

export function printUnknownRecordTypes(unknownRecordTypes: Set<string>): void {
  for (const recordType of unknownRecordTypes) {
    console.log(`unknown record type: ${recordType}`);
  }
}

const UNKNOWN_TYPE_REASON_PREFIX = "Unknown transcript record type";

// Any skipped line except an unknown record type stops the run.
function assertOnlyUnknownTypesSkipped(transcriptFile: Path, skippedLines: SkippedLine[], fileLines: string[]): void {
  for (const skippedLine of skippedLines) {
    const isUnknownType = skippedLine.reason.startsWith(UNKNOWN_TYPE_REASON_PREFIX);
    if (!isUnknownType) {
      const skippedText = (fileLines[skippedLine.lineNumber - 1] as string).slice(0, 200);
      throw new Error(`${transcriptFile.toString()}:${skippedLine.lineNumber} skipped (${skippedLine.reason}): ${skippedText}`);
    }
  }
}

// The loader rejects the line's type, so this parses the raw text without that check.
export function parseUnknownTypeLine(text: string): JSONLLine {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.timestamp === "string") {
    parsed.timestamp = new Date(parsed.timestamp);
  }
  return parsed as JSONLLine;
}

function mapRecordsByLineNumber(transcriptFile: Path, records: JSONLLine[], skippedLines: SkippedLine[], fileLines: string[], unknownRecordTypes: Set<string>): Map<number, JSONLLine> {
  const byLineNumber = new Map<number, JSONLLine>();
  for (const record of records) {
    byLineNumber.set((getRecordSource(record) as RecordSource).lineNumber, record);
  }
  for (const skippedLine of skippedLines) {
    const record = parseUnknownTypeLine(fileLines[skippedLine.lineNumber - 1] as string);
    setRecordSource(record, { filePath: transcriptFile.toString(), lineNumber: skippedLine.lineNumber });
    unknownRecordTypes.add(String(record.type));
    byLineNumber.set(skippedLine.lineNumber, record);
  }
  return byLineNumber;
}

function listRecordsInFileOrder(byLineNumber: Map<number, JSONLLine>, lineCount: number): JSONLLine[] {
  const ordered: JSONLLine[] = [];
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const record = byLineNumber.get(lineNumber);
    if (record !== undefined) {
      ordered.push(record);
    }
  }
  return ordered;
}

export function loadFileRecords(transcriptFile: Path, seenFieldIds: Set<string>, unknownFields: UnknownField[], unknownRecordTypes: Set<string>): JSONLLine[] {
  const { records, skippedLines } = loadTranscript(transcriptFile.toString(), undefined, true);
  const fileLines = readFileSync(transcriptFile.toString(), "utf8").split("\n");
  assertOnlyUnknownTypesSkipped(transcriptFile, skippedLines, fileLines);
  collectUnknownFields(records, seenFieldIds, unknownFields);
  const byLineNumber = mapRecordsByLineNumber(transcriptFile, records, skippedLines, fileLines, unknownRecordTypes);
  return listRecordsInFileOrder(byLineNumber, fileLines.length);
}

// A multi-source scenario folder holds each transcript twice: at the top and in source-*/projects. The first copy wins.
export function dropCopiedTranscripts(transcriptFiles: Path[]): Path[] {
  const seenFileIds = new Set<string>();
  const uniqueFiles: Path[] = [];
  for (const transcriptFile of transcriptFiles) {
    const contentHash = createHash("sha256").update(readFileSync(transcriptFile.toString())).digest("hex");
    const fileId = `${basename(transcriptFile.toString())}:${contentHash}`;
    const isNewFile = !seenFileIds.has(fileId);
    if (isNewFile) {
      seenFileIds.add(fileId);
      uniqueFiles.push(transcriptFile);
    }
  }
  return uniqueFiles;
}

// A Bash or ctx_execute call whose result comes much later waited for the user's permission, so the script ran just before its result.
const PERMISSION_WAIT_MILLISECONDS = 60000;
export function collectDelayedScriptCallTimes(records: JSONLLine[], sortTimeOverrides: Map<JSONLLine, number>): void {
  const resultTimeByCallId = new Map<string, number>();
  for (const record of records) {
    if (record.timestamp instanceof Date) {
      for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_result) {
          resultTimeByCallId.set(block.tool_use_id.toString(), record.timestamp.getTime());
        }
      }
    }
  }
  for (const record of records) {
    if (record.timestamp instanceof Date) {
      for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_use) {
          const isScriptTool = block.name === ToolName.Bash || block.name === ToolName.CtxExecute;
          const resultTime = resultTimeByCallId.get(block.id.toString());
          if (isScriptTool && resultTime !== undefined) {
            if (resultTime - record.timestamp.getTime() > PERMISSION_WAIT_MILLISECONDS) {
              sortTimeOverrides.set(record, resultTime);
            }
          }
        }
      }
    }
  }
}

// Subagent transcripts are included; the engine's timestamp rule orders the lines.
function readMergedJSONLLines(jsonlFolders: string[], reportProgress: ReportPhaseProgress): MergedJSONLLines {
  const recordLists: JSONLLine[][] = [];
  const unknownFields: UnknownField[] = [];
  const seenFieldIds = new Set<string>();
  const unknownRecordTypes = new Set<string>();
  const transcriptFiles = dropCopiedTranscripts(listTranscriptFiles(jsonlFolders));
  for (const transcriptFile of transcriptFiles) {
    recordLists.push(loadFileRecords(transcriptFile, seenFieldIds, unknownFields, unknownRecordTypes));
    reportProgress(recordLists.length, transcriptFiles.length);
  }
  const sortTimeOverrides = new Map<JSONLLine, number>();
  for (const recordList of recordLists) {
    collectDelayedScriptCallTimes(recordList, sortTimeOverrides);
  }
  printUnknownFields(unknownFields);
  printUnknownRecordTypes(unknownRecordTypes);
  return { jsonlLines: mergeRecordsByTimestamp(recordLists, sortTimeOverrides), unknownFields, unknownRecordTypes: [...unknownRecordTypes], transcriptFileCount: transcriptFiles.length };
}

// A big project takes minutes to read, and the replay asks for the same folders twice.
const mergedLinesByFolders = new Map<string, MergedJSONLLines>();
export function loadMergedJSONLLines(jsonlFolders: string[], reportProgress: ReportPhaseProgress = ignorePhaseProgress): MergedJSONLLines {
  const foldersKey = JSON.stringify(jsonlFolders);
  const memoizedLines = mergedLinesByFolders.get(foldersKey);
  if (memoizedLines !== undefined) {
    return memoizedLines;
  }
  const mergedLines = readMergedJSONLLines(jsonlFolders, reportProgress);
  mergedLinesByFolders.set(foldersKey, mergedLines);
  return mergedLines;
}

// The earliest timestamp of any line; the replay start point is read at this time.
export function getFirstLineTime(jsonlLines: JSONLLine[]): Date {
  let firstTime: Date | undefined;
  for (const line of jsonlLines) {
    if (line.timestamp instanceof Date) {
      if (firstTime === undefined || line.timestamp.getTime() < firstTime.getTime()) {
        firstTime = line.timestamp;
      }
    }
  }
  if (firstTime === undefined) {
    throw new Error("getFirstLineTime: no JSONL line has a timestamp");
  }
  return firstTime;
}

// function getCommitTimeInMilliseconds(repo: Path, commit: CommitHash): number {
//   const output = executeGit(repo, ["show", "-s", "--format=%ct", commit.toString()]);
//   return Number(output.toString("utf8").trim()) * 1000;
// }

// The index of the first line stamped later than the commit time.
export function getLineNumForCommit(repo: Path, commit: CommitHash, jsonlLines: JSONLLine[]): number {
  const commitDate = readCommitTimestamp(repo, commit);
  if (commitDate === undefined) {
    throw new Error(`no commit time for ${commit.toString()} in ${repo.toString()}`);
  }
  const commitTime = commitDate.getTime();
  for (const [lineNum, line] of jsonlLines.entries()) {
    const lineTime = line.timestamp?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (lineTime > commitTime) {
      return lineNum;
    }
  }
  return jsonlLines.length;
}
