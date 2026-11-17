// Walks backwards from the file on disk through the Write/Edit rows that changed it, listing every earlier state.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isInsideGitWorkTree } from "../src/reconstruction_script_sandbox_project.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { getRecordSource, setRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";
import { parseRecord } from "../src/parse/parseRecord.ts";
import { mergeRecordsByTimestamp } from "../src/reconstruction_multi_source.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { getFileHistorySnapshot, type FileHistoryBackup, type FileHistorySnapshotMessage } from "../src/structures/file-history.ts";
import { listRunsInRecord, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { collectErroredToolUseIds } from "../src/structures/tool-results.ts";
import { KNOWN_RECORD_TYPES, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { executeGit, type CommitHash, type JSONLLine } from "./engineV3.ts";
import { loadMergedJSONLLines } from "./engineV3_jsonl_lines.ts";
import { ERRORED_RESULT_KEY_TEXT } from "./engineV3_jsonl_lines_naming_files.ts";
import { collectWriteEditResultLines } from "./engineV3_replay_tool_results.ts";
import type { ReverseSettings } from "./engineV3_replay_settings.ts";
import { getReverseStatesForFile } from "./engineV3_replay_reverse_events.ts";

export enum ReverseStateKind {
  DiskNow = "DiskNow",
  EditUndone = "EditUndone",
  WriteUndone = "WriteUndone",
  FileCreated = "FileCreated",
  UnknownChange = "UnknownChange",
  ScriptChange = "ScriptChange",
  GitCommit = "GitCommit",
  BackupSnapshot = "BackupSnapshot",
  ReadOnly = "ReadOnly",
  PossibleChange = "PossibleChange",
}

// The full text of the file at one instant. A commit has a commitHash; a backup has the transcript row of its snapshot as source when known.
export type KnownFileState = { timestamp: Date; content: string; commitHash: CommitHash | undefined; source: RecordSource | undefined };

export type ReverseFileState = {
  index: number;
  kind: ReverseStateKind;
  timestamp: Date | undefined;
  content: string | undefined;
  jsonlPath: Path | undefined;
  lineNumber: number | undefined;
  commitHash: CommitHash | undefined;
  isModifying: boolean;
};

export type WriteRow = { toolName: ToolName.Write; timestamp: Date; source: RecordSource | undefined; isCreate: boolean; content: string; originalFile: string | undefined };
export type EditRow = { toolName: ToolName.Edit; timestamp: Date; source: RecordSource | undefined; oldString: string; newString: string; replaceAll: boolean; originalFile: string | undefined };
export type FileChangeRow = WriteRow | EditRow;

// isKnown false means the text cannot be worked out; a known text of undefined means the file does not exist.
type TextKnowledge = { isKnown: boolean; text: string | undefined };
const UNKNOWN_TEXT: TextKnowledge = { isKnown: false, text: undefined };

type RowUndo = { matchesCurrentText: boolean; textAfter: string | undefined; textBefore: TextKnowledge };
type KnownTextCandidate = { timestamp: Date; content: string; resumeIndex: number; source: RecordSource | undefined };

function createKnownText(text: string | undefined): TextKnowledge {
  return { isKnown: true, text };
}

export function readDiskText(file: Path): string | undefined {
  if (!existsSync(file.toString())) {
    return undefined;
  }
  return readFileSync(file.toString(), "utf8");
}

function getStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function parseWriteRow(result: Record<string, unknown>, content: string, timestamp: Date, source: RecordSource | undefined): WriteRow {
  const writeType = result.type;
  if (writeType !== "create") {
    if (writeType !== "update") {
      throw new Error(`parseWriteRow: unknown Write result type ${String(writeType)}`);
    }
  }
  return { toolName: ToolName.Write, timestamp, source, isCreate: writeType === "create", content, originalFile: getStringOrUndefined(result.originalFile) };
}

function parseEditRow(result: Record<string, unknown>, oldString: string, timestamp: Date, source: RecordSource | undefined): EditRow {
  const newString = getStringOrUndefined(result.newString);
  if (newString === undefined) {
    throw new Error("parseEditRow: the Edit result has no newString");
  }
  return { toolName: ToolName.Edit, timestamp, source, oldString, newString, replaceAll: result.replaceAll === true, originalFile: getStringOrUndefined(result.originalFile) };
}

// Undefined when the line is not an applied Write/Edit result of the file.
export function parseFileChangeRow(line: JSONLLine, file: Path): FileChangeRow | undefined {
  if (line.type !== RecordType.user) {
    return undefined;
  }
  const raw = line.toolUseResult;
  if (typeof raw !== "object") {
    return undefined;
  }
  if (raw === null) {
    return undefined;
  }
  const result = raw as Record<string, unknown>;
  const filePath = getStringOrUndefined(result.filePath);
  if (filePath === undefined) {
    return undefined;
  }
  if (!new Path(filePath).equals(file)) {
    return undefined;
  }
  if (!(line.timestamp instanceof Date)) {
    throw new Error("parseFileChangeRow: the result line has no timestamp");
  }
  const source = getRecordSource(line);
  const oldString = getStringOrUndefined(result.oldString);
  if (oldString !== undefined) {
    return parseEditRow(result, oldString, line.timestamp, source);
  }
  const content = getStringOrUndefined(result.content);
  if (content !== undefined) {
    return parseWriteRow(result, content, line.timestamp, source);
  }
  return undefined;
}

// Rejected and failed calls have a text toolUseResult, so they give no row.
export function listFileChangeRowsNewestFirst(jsonlLines: JSONLLine[], file: Path): FileChangeRow[] {
  const rows: FileChangeRow[] = [];
  for (const resultLine of collectWriteEditResultLines(jsonlLines).values()) {
    const row = parseFileChangeRow(resultLine, file);
    if (row !== undefined) {
      rows.push(row);
    }
  }
  rows.reverse();
  rows.sort((leftRow, rightRow) => rightRow.timestamp.getTime() - leftRow.timestamp.getTime());
  return rows;
}

export function countOccurrences(text: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  let count = 0;
  let position = text.indexOf(needle);
  while (position !== -1) {
    count++;
    position = text.indexOf(needle, position + 1);
  }
  return count;
}

export function applyEditToText(text: string, row: EditRow): string {
  const position = text.indexOf(row.oldString);
  if (position === -1) {
    throw new Error(`applyEditToText: oldString not found in originalFile of the Edit at ${row.timestamp.toISOString()}`);
  }
  if (row.replaceAll) {
    return text.split(row.oldString).join(row.newString);
  }
  return text.slice(0, position) + row.newString + text.slice(position + row.oldString.length);
}

// Undefined when the text right after the row cannot be known.
function findTextAfterRow(row: FileChangeRow): string | undefined {
  if (row.toolName === ToolName.Write) {
    return row.content;
  }
  if (row.originalFile === undefined) {
    return undefined;
  }
  return applyEditToText(row.originalFile, row);
}

function findTextBeforeRow(row: FileChangeRow): TextKnowledge {
  if (row.toolName === ToolName.Write) {
    if (row.isCreate) {
      return createKnownText(undefined);
    }
  }
  if (row.originalFile === undefined) {
    return UNKNOWN_TEXT;
  }
  return createKnownText(row.originalFile);
}

// An Edit with no originalFile can be undone only when newString sits in the current text exactly once.
function computeEditUndoFromCurrentText(row: EditRow, currentText: string | undefined): RowUndo {
  const notUndoable: RowUndo = { matchesCurrentText: false, textAfter: undefined, textBefore: UNKNOWN_TEXT };
  if (row.replaceAll) {
    return notUndoable;
  }
  if (currentText === undefined) {
    return notUndoable;
  }
  if (countOccurrences(currentText, row.newString) !== 1) {
    return notUndoable;
  }
  const position = currentText.indexOf(row.newString);
  const swappedText = currentText.slice(0, position) + row.oldString + currentText.slice(position + row.newString.length);
  return { matchesCurrentText: true, textAfter: undefined, textBefore: createKnownText(swappedText) };
}

export function computeRowUndo(row: FileChangeRow, currentText: string | undefined): RowUndo {
  const textAfter = findTextAfterRow(row);
  if (textAfter !== undefined) {
    return { matchesCurrentText: currentText === textAfter, textAfter, textBefore: findTextBeforeRow(row) };
  }
  return computeEditUndoFromCurrentText(row as EditRow, currentText);
}

function findFirstRowIndexAtOrBefore(rows: FileChangeRow[], timestamp: Date): number {
  for (const [index, row] of rows.entries()) {
    if (row.timestamp.getTime() <= timestamp.getTime()) {
      return index;
    }
  }
  return rows.length;
}

function findNewestKnownRowText(rows: FileChangeRow[], firstIndex: number): KnownTextCandidate | undefined {
  for (let index = firstIndex; index < rows.length; index++) {
    const row = rows[index]!;
    const textAfter = findTextAfterRow(row);
    if (textAfter !== undefined) {
      return { timestamp: row.timestamp, content: textAfter, resumeIndex: index, source: row.source };
    }
  }
  return undefined;
}

// Only extra states strictly older than the row count: the row is not part of their text.
function findNewestExtraText(rows: FileChangeRow[], rowIndex: number, extraKnownStates: KnownFileState[]): KnownTextCandidate | undefined {
  let newest: KnownTextCandidate | undefined;
  for (const extraState of extraKnownStates) {
    const isOlderThanRow = extraState.timestamp.getTime() < rows[rowIndex]!.timestamp.getTime();
    if (isOlderThanRow) {
      let isNewerThanNewest = true;
      if (newest !== undefined) {
        isNewerThanNewest = extraState.timestamp.getTime() > newest.timestamp.getTime();
      }
      if (isNewerThanNewest) {
        newest = { timestamp: extraState.timestamp, content: extraState.content, resumeIndex: findFirstRowIndexAtOrBefore(rows, extraState.timestamp), source: undefined };
      }
    }
  }
  return newest;
}

// The row's own text counts only when includeOwnText is true. A row text wins a tie with an extra state.
function findNewestKnownText(rows: FileChangeRow[], rowIndex: number, includeOwnText: boolean, extraKnownStates: KnownFileState[]): KnownTextCandidate | undefined {
  let firstIndex = rowIndex + 1;
  if (includeOwnText) {
    firstIndex = rowIndex;
  }
  const rowCandidate = findNewestKnownRowText(rows, firstIndex);
  const extraCandidate = findNewestExtraText(rows, rowIndex, extraKnownStates);
  if (rowCandidate === undefined) {
    return extraCandidate;
  }
  if (extraCandidate === undefined) {
    return rowCandidate;
  }
  if (extraCandidate.timestamp.getTime() > rowCandidate.timestamp.getTime()) {
    return extraCandidate;
  }
  return rowCandidate;
}

function escapeRegExpText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A name inside a longer name (xa.txt, a.txt.bak, my-a.txt) does not count.
export function createFileNamePattern(file: Path): RegExp {
  return new RegExp(`(?<![\\w.-])${escapeRegExpText(basename(file.toString()))}(?![\\w-]|\\.\\w)`);
}

export function collectScriptRuns(jsonlLines: JSONLLine[]): ScriptRun[] {
  const erroredToolUseIds = collectErroredToolUseIds(jsonlLines);
  const scriptRuns: ScriptRun[] = [];
  for (const line of jsonlLines) {
    for (const scriptRun of listRunsInRecord(line)) {
      if (!erroredToolUseIds.has(scriptRun.toolUseId!.toString())) {
        scriptRuns.push(scriptRun);
      }
    }
  }
  return scriptRuns;
}

// windowEnd undefined means the window runs to now.
export function isFileNamedByScriptInWindow(scriptRuns: ScriptRun[], file: Path, windowStart: Date, windowEnd: Date | undefined): boolean {
  const fileNamePattern = createFileNamePattern(file);
  for (const scriptRun of scriptRuns) {
    if (scriptRun.timestamp.getTime() > windowStart.getTime()) {
      let isBeforeWindowEnd = true;
      if (windowEnd !== undefined) {
        isBeforeWindowEnd = scriptRun.timestamp.getTime() < windowEnd.getTime();
      }
      if (isBeforeWindowEnd) {
        if (fileNamePattern.test(scriptRun.code)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function createReverseState(index: number, kind: ReverseStateKind, timestamp: Date | undefined, content: string | undefined, source: RecordSource | undefined, commitHash: CommitHash | undefined = undefined, isModifying: boolean = true): ReverseFileState {
  if (source === undefined) {
    return { index, kind, timestamp, content, jsonlPath: undefined, lineNumber: undefined, commitHash, isModifying };
  }
  return { index, kind, timestamp, content, jsonlPath: new Path(source.filePath), lineNumber: source.lineNumber, commitHash, isModifying };
}

export function getUndoneStateKind(row: FileChangeRow): ReverseStateKind {
  if (row.toolName === ToolName.Edit) {
    return ReverseStateKind.EditUndone;
  }
  if (row.isCreate) {
    return ReverseStateKind.FileCreated;
  }
  return ReverseStateKind.WriteUndone;
}

export function walkFileBackwards(file: Path, jsonlsFolder: Path, extraKnownStates: KnownFileState[]): ReverseFileState[] {
  const jsonlLines = loadMergedJSONLLines([jsonlsFolder.toString()]).jsonlLines;
  return walkFileBackwardsThroughLines(file, jsonlLines, extraKnownStates);
}

function walkFileBackwardsThroughLines(file: Path, jsonlLines: JSONLLine[], extraKnownStates: KnownFileState[]): ReverseFileState[] {
  const rows = listFileChangeRowsNewestFirst(jsonlLines, file);
  const scriptRuns = collectScriptRuns(jsonlLines);
  const diskText = readDiskText(file);
  const states: ReverseFileState[] = [{ index: 0, kind: ReverseStateKind.DiskNow, timestamp: undefined, content: diskText, jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true }];
  let currentText = diskText;
  let rowIndex = 0;
  while (rowIndex < rows.length) {
    const row = rows[rowIndex]!;
    const rowUndo = computeRowUndo(row, currentText);
    if (rowUndo.matchesCurrentText) {
      if (rowUndo.textBefore.isKnown) {
        states.push(createReverseState(states.length, getUndoneStateKind(row), row.timestamp, rowUndo.textBefore.text, row.source));
        currentText = rowUndo.textBefore.text;
        rowIndex++;
        continue;
      }
    }
    // A row text that failed the check is the newest known text; otherwise the row cannot be stepped past and only older texts help.
    let includeOwnText = false;
    if (!rowUndo.matchesCurrentText) {
      includeOwnText = rowUndo.textAfter !== undefined;
    }
    const candidate = findNewestKnownText(rows, rowIndex, includeOwnText, extraKnownStates);
    if (candidate === undefined) {
      break;
    }
    let gapKind = ReverseStateKind.UnknownChange;
    if (isFileNamedByScriptInWindow(scriptRuns, file, candidate.timestamp, states[states.length - 1]!.timestamp)) {
      gapKind = ReverseStateKind.ScriptChange;
    }
    states.push(createReverseState(states.length, gapKind, candidate.timestamp, candidate.content, candidate.source));
    currentText = candidate.content;
    rowIndex = candidate.resumeIndex;
  }
  return states;
}

export function formatReverseStateLine(state: ReverseFileState): string {
  let timestampText = "now";
  if (state.timestamp !== undefined) {
    timestampText = state.timestamp.toISOString();
  }
  let lengthText = "absent";
  if (state.content !== undefined) {
    lengthText = String(Buffer.byteLength(state.content, "utf8"));
  }
  if (state.commitHash !== undefined) {
    return `${state.index}  ${timestampText}  ${state.kind}  ${lengthText}  ${state.commitHash.toString().slice(0, 7)}`;
  }
  return `${state.index}  ${timestampText}  ${state.kind}  ${lengthText}`;
}

const JSONL_EXTENSION = ".jsonl";

function getFileHistoryFolder(jsonlsFolder: Path): string {
  const fileHistoryFolder = resolve(jsonlsFolder.toString(), "..", "..", "file-history");
  if (!existsSync(fileHistoryFolder)) {
    throw new Error(`getFileHistoryFolder: ${fileHistoryFolder} does not exist`);
  }
  return fileHistoryFolder;
}

function getLineSourceFile(line: JSONLLine): string {
  const source = getRecordSource(line);
  if (source === undefined) {
    throw new Error("getLineSourceFile: the JSONL line has no source file");
  }
  return source.filePath;
}

function mapSourceFilesToCwd(jsonlLines: JSONLLine[]): Map<string, Path> {
  const cwdBySourceFile = new Map<string, Path>();
  for (const line of jsonlLines) {
    if (line.cwd !== undefined) {
      const sourceFile = getLineSourceFile(line);
      if (!cwdBySourceFile.has(sourceFile)) {
        cwdBySourceFile.set(sourceFile, line.cwd);
      }
    }
  }
  return cwdBySourceFile;
}

// A relative key is relative to the session's cwd; realParentDir names the real folder when present.
function findBackedUpFile(key: Path, backup: FileHistoryBackup, sessionCwd: Path | undefined): Path {
  if (backup.realParentDir !== undefined) {
    return new Path(join(backup.realParentDir.toString(), basename(key.toString())));
  }
  if (isAbsolute(key.toString())) {
    return key;
  }
  if (sessionCwd === undefined) {
    throw new Error(`findBackedUpFile: the key ${key.toString()} is relative and its session has no cwd`);
  }
  return new Path(resolve(sessionCwd.toString(), key.toString()));
}

function listBackupsOfFile(snapshotMessage: FileHistorySnapshotMessage, file: Path, sessionCwd: Path | undefined): FileHistoryBackup[] {
  const backups: FileHistoryBackup[] = [];
  for (const [key, backup] of snapshotMessage.snapshot.trackedFileBackups.listEntries()) {
    if (findBackedUpFile(key, backup, sessionCwd).equals(file)) {
      backups.push(backup);
    }
  }
  return backups;
}

// function findFolderContainingSourceFile(sourceFile: string, jsonlsFolders: Path[]): Path {
//   for (const jsonlsFolder of jsonlsFolders) {
//     if (resolve(sourceFile).startsWith(resolve(jsonlsFolder.toString()) + sep)) {
//       return jsonlsFolder;
//     }
//   }
//   throw new Error(`findFolderContainingSourceFile: ${sourceFile} is inside none of the given transcripts folders`);
// }

const FILE_HISTORY_FOLDER_NAME = "file-history";

// Undefined when no folder holds the backup: recovery data lacks some file-history folders. A recovery copy of a Claude home keeps them in its file-history subfolder.
function findExistingBackupFile(fileHistoryFolders: Path[], sessionId: string, backupFileName: string): string | undefined {
  for (const fileHistoryFolder of fileHistoryFolders) {
    const backupFile = join(fileHistoryFolder.toString(), sessionId, backupFileName);
    if (existsSync(backupFile)) {
      return backupFile;
    }
    const nestedBackupFile = join(fileHistoryFolder.toString(), FILE_HISTORY_FOLDER_NAME, sessionId, backupFileName);
    if (existsSync(nestedBackupFile)) {
      return nestedBackupFile;
    }
  }
  return undefined;
}

export function collectBackupKnownStates(file: Path, jsonlLines: JSONLLine[], fileHistoryFolders: Path[]): KnownFileState[] {
  // const fileHistoryFolderByJsonlsFolder = new Map<string, string>();
  // for (const jsonlsFolder of jsonlsFolders) {
  //   fileHistoryFolderByJsonlsFolder.set(jsonlsFolder.toString(), getFileHistoryFolder(jsonlsFolder));
  // }
  const cwdBySourceFile = mapSourceFilesToCwd(jsonlLines);
  const seenBackupFiles = new Set<string>();
  const knownStates: KnownFileState[] = [];
  for (const line of jsonlLines) {
    const snapshotMessage = getFileHistorySnapshot(line);
    if (snapshotMessage !== undefined) {
      const sourceFile = getLineSourceFile(line);
      const sessionId = basename(sourceFile, JSONL_EXTENSION);
      // const fileHistoryFolder = fileHistoryFolderByJsonlsFolder.get(findFolderContainingSourceFile(sourceFile, jsonlsFolders).toString())!;
      for (const backup of listBackupsOfFile(snapshotMessage, file, cwdBySourceFile.get(sourceFile))) {
        if (backup.backupFileName !== null) {
          // const backupFile = join(fileHistoryFolder, sessionId, backup.backupFileName.toString());
          const backupFile = findExistingBackupFile(fileHistoryFolders, sessionId, backup.backupFileName.toString());
          if (backupFile !== undefined) {
            if (!seenBackupFiles.has(backupFile)) {
              seenBackupFiles.add(backupFile);
              knownStates.push({ timestamp: backup.backupTime, content: readFileSync(backupFile, "utf8"), commitHash: undefined, source: { filePath: sourceFile, lineNumber: getRecordSource(line)!.lineNumber } });
            }
          }
        }
      }
    }
  }
  return knownStates;
}

const GITLINK_MODE = "160000";

// Asks git from the nearest existing folder, and a file outside a git work tree has no states; --diff-filter=d leaves out the commits that deleted the file.
export function collectGitKnownStates(file: Path): KnownFileState[] {
  let folder = new Path(dirname(file.toString()));
  while (!existsSync(folder.toString())) {
    folder = new Path(dirname(folder.toString()));
  }
  if (!isInsideGitWorkTree(folder)) {
    return [];
  }
  const fileName = relative(folder.toString(), file.toString());
  // const logText = executeGit(folder, ["log", "--diff-filter=d", "--format=%H %ct", "--", `./${fileName}`]).toString("utf8");
  // const knownStates: KnownFileState[] = [];
  // for (const logRow of logText.split("\n")) {
  //   if (logRow !== "") {
  //     const [commitHash, committerSeconds] = logRow.split(" ") as [string, string];
  //     const content = executeGit(folder, ["show", `${commitHash}:./${fileName}`]).toString("utf8");
  //     knownStates.push({ timestamp: new Date(Number(committerSeconds) * 1000), content, commitHash: new Uuid(commitHash), source: undefined });
  //   }
  // }
  // return knownStates;
  const logText = executeGit(folder, ["log", "--diff-filter=d", "--raw", "--format=%H %ct", "--", `./${fileName}`]).toString("utf8");
  const logEntries: { commitHash: string; committerSeconds: string; isGitlinkEntry: boolean }[] = [];
  for (const logRow of logText.split("\n")) {
    if (logRow !== "") {
      if (logRow.startsWith(":")) {
        const newMode = logRow.split(" ")[1];
        if (newMode === GITLINK_MODE) {
          logEntries[logEntries.length - 1]!.isGitlinkEntry = true;
        }
      } else {
        const [commitHash, committerSeconds] = logRow.split(" ") as [string, string];
        logEntries.push({ commitHash, committerSeconds, isGitlinkEntry: false });
      }
    }
  }
  const knownStates: KnownFileState[] = [];
  for (const logEntry of logEntries) {
    if (!logEntry.isGitlinkEntry) {
      const content = executeGit(folder, ["show", `${logEntry.commitHash}:./${fileName}`]).toString("utf8");
      knownStates.push({ timestamp: new Date(Number(logEntry.committerSeconds) * 1000), content, commitHash: new Uuid(logEntry.commitHash), source: undefined });
    }
  }
  return knownStates;
}

const NEWLINE_BYTE = 0x0a;
export const CWD_KEY_TEXT = '"cwd":"';
export const KNOWN_RECORD_TYPE_SET = new Set<string>(KNOWN_RECORD_TYPES);

export type LineSpan = { start: number; end: number };

function findLineSpanAround(transcriptBytes: Buffer, position: number): LineSpan {
  const start = transcriptBytes.lastIndexOf(NEWLINE_BYTE, position) + 1;
  let end = transcriptBytes.indexOf(NEWLINE_BYTE, position);
  if (end === -1) {
    end = transcriptBytes.length;
  }
  return { start, end };
}

// The first line holding a cwd is added when any line matched, because mapSourceFilesToCwd needs one per source file.
function listLineSpansNamingText(transcriptBytes: Buffer, needleText: string): LineSpan[] {
  const needle = Buffer.from(needleText);
  const spans: LineSpan[] = [];
  let position = transcriptBytes.indexOf(needle);
  while (position !== -1) {
    const span = findLineSpanAround(transcriptBytes, position);
    spans.push(span);
    position = transcriptBytes.indexOf(needle, span.end + 1);
  }
  if (spans.length === 0) {
    return spans;
  }
  const cwdPosition = transcriptBytes.indexOf(CWD_KEY_TEXT);
  if (cwdPosition !== -1) {
    const cwdSpan = findLineSpanAround(transcriptBytes, cwdPosition);
    if (!spans.some((span) => span.start === cwdSpan.start)) {
      spans.push(cwdSpan);
      spans.sort((leftSpan, rightSpan) => leftSpan.start - rightSpan.start);
    }
  }
  return spans;
}

export function countNewlinesBefore(transcriptBytes: Buffer, from: number, to: number): number {
  let count = 0;
  let position = transcriptBytes.indexOf(NEWLINE_BYTE, from);
  while (position !== -1) {
    if (position >= to) {
      break;
    }
    count++;
    position = transcriptBytes.indexOf(NEWLINE_BYTE, position + 1);
  }
  return count;
}

// Only the matching lines are decoded and parsed, so a transcript of any size costs one scan.
function listRecordsNamingText(transcriptFile: Path, needleText: string): JSONLLine[] {
  const transcriptBytes = readFileSync(transcriptFile.toString());
  const records: JSONLLine[] = [];
  let lineNumber = 1;
  let countedUpTo = 0;
  for (const span of listLineSpansNamingText(transcriptBytes, needleText)) {
    lineNumber += countNewlinesBefore(transcriptBytes, countedUpTo, span.start);
    countedUpTo = span.start;
    const lineText = transcriptBytes.toString("utf8", span.start, span.end);
    // The walk reads only known record types; an unknown type (api-request-blob) never holds a Write/Edit result, a script call or a snapshot.
    const recordType = (JSON.parse(lineText) as { type?: unknown }).type;
    if (KNOWN_RECORD_TYPE_SET.has(String(recordType))) {
      const record = parseRecord(lineText);
      setRecordSource(record, { filePath: transcriptFile.toString(), lineNumber });
      records.push(record);
    }
  }
  return records;
}

// A Write/Edit call and its result both carry the file path, so every line the walk needs holds the file's base name. An error result names no file, so its line is added too.
export function loadJSONLLinesNamingFile(file: Path, jsonlsFolders: Path[]): JSONLLine[] {
  const needleText = JSON.stringify(basename(file.toString())).slice(1, -1);
  const recordLists: JSONLLine[][] = [];
  for (const transcriptFile of listTranscriptFiles(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString()))) {
    const records = listRecordsNamingText(transcriptFile, needleText);
    if (records.length > 0) {
      const knownLineNumbers = new Set(records.map((record) => getRecordSource(record)!.lineNumber));
      for (const erroredRecord of listRecordsNamingText(transcriptFile, ERRORED_RESULT_KEY_TEXT)) {
        if (!knownLineNumbers.has(getRecordSource(erroredRecord)!.lineNumber)) {
          records.push(erroredRecord);
        }
      }
      records.sort((leftRecord, rightRecord) => getRecordSource(leftRecord)!.lineNumber - getRecordSource(rightRecord)!.lineNumber);
      recordLists.push(records);
    }
  }
  return mergeRecordsByTimestamp(recordLists);
}

export function walkFileBackwardsWithKnownStates(file: Path, jsonlsFolders: Path[], fileHistoryFolders: Path[]): ReverseFileState[] {
  // const jsonlLines = loadMergedJSONLLines(jsonlsFolders.map((jsonlsFolder) => jsonlsFolder.toString())).jsonlLines;
  const jsonlLines = loadJSONLLinesNamingFile(file, jsonlsFolders);
  const backupKnownStates = collectBackupKnownStates(file, jsonlLines, fileHistoryFolders);
  const gitKnownStates = collectGitKnownStates(file);
  return walkFileBackwardsThroughLines(file, jsonlLines, [...backupKnownStates, ...gitKnownStates]);
}

export function printReverseWalk(settings: ReverseSettings): void {
  const derivedFileHistoryFolder = new Path(getFileHistoryFolder(settings.jsonlsFolder));
  // for (const state of walkFileBackwardsWithKnownStates(settings.file, [settings.jsonlsFolder], [derivedFileHistoryFolder])) {
  for (const state of getReverseStatesForFile(settings.file, [settings.jsonlsFolder], [derivedFileHistoryFolder]).states) {
    console.log(formatReverseStateLine(state));
  }
}
