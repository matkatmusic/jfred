// Loads every transcript line under the JSONL folders as one time-ordered list.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { mergeRecordsByTimestamp } from "../src/reconstruction_multi_source.ts";
import { readCommitTimestamp } from "../src/reconstruction_base_commit_evidence.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { getContentBlocks } from "../src/structures/content-blocks.ts";
import { BlockType, ToolName } from "../src/structures/vocabulary.ts";
import type { CommitHash, JSONLLine } from "./engineV3.ts";
import { setBashCallCwdsToShellCwds } from "./engineV3_jsonl_bash_cwd.ts";
import { loadFileRecords, type UnknownField } from "./engineV3_jsonl_file_records.ts";
import { ignorePhaseProgress, type ReportPhaseProgress } from "./engineV3_startup_progress.ts";

export type MergedJSONLLines = { jsonlLines: JSONLLine[]; unknownFields: UnknownField[]; unknownRecordTypes: string[]; transcriptFileCount: number };

function printUnknownFields(unknownFields: UnknownField[]): void {
  for (const unknownField of unknownFields) {
    console.log(`unknown field: ${unknownField.recordType}.${unknownField.fieldName}`);
  }
}

function printUnknownRecordTypes(unknownRecordTypes: Set<string>): void {
  for (const recordType of unknownRecordTypes) {
    console.log(`unknown record type: ${recordType}`);
  }
}

function getTranscriptFileId(transcriptFile: Path): string {
  const hasher = createHash("sha256");
  hasher.update(readFileSync(transcriptFile.toString()));
  return `${basename(transcriptFile.toString())}:${hasher.digest("hex")}`;
}

// A multi-source scenario folder holds each transcript twice: at the top and in source-*/projects. The first copy wins.
function filterOutCopiedTranscripts(transcriptFiles: Path[]): Path[] {
  const seenFileIds = new Set<string>();
  const uniqueFiles: Path[] = [];
  for (const transcriptFile of transcriptFiles) {
    const fileId = getTranscriptFileId(transcriptFile);
    const isNewFile = !seenFileIds.has(fileId);
    if (isNewFile) {
      seenFileIds.add(fileId);
      uniqueFiles.push(transcriptFile);
    }
  }
  return uniqueFiles;
}

function getResultTimeByCallId(records: JSONLLine[]): Map<string, number> {
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
  return resultTimeByCallId;
}

// A Bash or ctx_execute call whose result comes much later waited for the user's permission, so the script ran just before its result.
const PERMISSION_WAIT_MILLISECONDS = 60000;
function collectDelayedCallTimesInRecord(record: JSONLLine, callTime: number, resultTimeByCallId: Map<string, number>, sortTimeOverrides: Map<JSONLLine, number>): void {
  for (const block of getContentBlocks(record)) {
    if (block.type === BlockType.tool_use) {
      const isScriptTool = block.name === ToolName.Bash || block.name === ToolName.CtxExecute;
      const resultTime = resultTimeByCallId.get(block.id.toString());
      if (isScriptTool) {
        if (resultTime !== undefined) {
          if (resultTime - callTime > PERMISSION_WAIT_MILLISECONDS) {
            sortTimeOverrides.set(record, resultTime);
          }
        }
      }
    }
  }
}

function collectDelayedScriptCallTimes(records: JSONLLine[], sortTimeOverrides: Map<JSONLLine, number>): void {
  const resultTimeByCallId = getResultTimeByCallId(records);
  for (const record of records) {
    if (record.timestamp instanceof Date) {
      collectDelayedCallTimesInRecord(record, record.timestamp.getTime(), resultTimeByCallId, sortTimeOverrides);
    }
  }
}

function createSortTimeOverrides(recordLists: JSONLLine[][]): Map<JSONLLine, number> {
  const sortTimeOverrides = new Map<JSONLLine, number>();
  for (const recordList of recordLists) {
    collectDelayedScriptCallTimes(recordList, sortTimeOverrides);
  }
  return sortTimeOverrides;
}

// Subagent transcripts are included; the engine's timestamp rule orders the lines.
// export function loadMergedJSONLLines(jsonlFolders: string[]): MergedJSONLLines {
function readMergedJSONLLines(jsonlFolders: string[], reportProgress: ReportPhaseProgress): MergedJSONLLines {
  const recordLists: JSONLLine[][] = [];
  const unknownFields: UnknownField[] = [];
  const seenFieldIds = new Set<string>();
  const unknownRecordTypes = new Set<string>();
  const transcriptFiles = filterOutCopiedTranscripts(listTranscriptFiles(jsonlFolders));
  for (const transcriptFile of transcriptFiles) {
    const fileRecords = loadFileRecords(transcriptFile, seenFieldIds, unknownFields, unknownRecordTypes);
    setBashCallCwdsToShellCwds(fileRecords);
    recordLists.push(fileRecords);
    reportProgress(recordLists.length, transcriptFiles.length);
  }
  const sortTimeOverrides = createSortTimeOverrides(recordLists);
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
