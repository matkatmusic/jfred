// Checks the replayed files against the file-history backups that a snapshot line names.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";
import { getFileHistorySnapshot, type FileHistoryBackup } from "../src/structures/file-history.ts";
import { getGitUnifiedDiff } from "../src/render_git_diff.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
import { ABSENT_BEFORE_CONTENT, findPendingBeforeContent, type BeforeContent } from "./engineV3_replay_pending_writes.ts";

const JSONL_EXTENSION = ".jsonl";
const lastSeenBackupTexts = new Map<string, string>();

function getSourceOfLine(line: JSONLLine): RecordSource {
  const source = getRecordSource(line);
  if (source === undefined) {
    throw new Error("getSourceOfLine: the JSONL line has no source file");
  }
  return source;
}

// The file-history folder of a session is named like the session's JSONL file.
function getBackupFilePath(fileHistoryPath: Path | undefined, line: JSONLLine, backupFileName: Path): string {
  if (fileHistoryPath === undefined) {
    throw new Error(`getBackupFilePath: backup ${backupFileName.toString()} is named but --file-history was not given`);
  }
  const sessionId = basename(getSourceOfLine(line).filePath, JSONL_EXTENSION);
  return join(fileHistoryPath.toString(), sessionId, backupFileName.toString());
}

function createLineText(line: JSONLLine): string {
  const source = getSourceOfLine(line);
  return `JSONL line: ${source.filePath}:${source.lineNumber}`;
}

function createMismatchMessage(replayedFile: string, line: JSONLLine, expectedText: string, actualText: string): string {
  const diffText = getGitUnifiedDiff(expectedText.split("\n"), actualText.split("\n"));
  const rows = [`assertSnapshotBackupsMatchState: ${replayedFile} differs from its backup`, createLineText(line)];
  rows.push(`backup text: ${JSON.stringify(expectedText)}`, `replayed text: ${JSON.stringify(actualText)}`, `diff, backup to replayed:\n${diffText}`);
  return rows.join("\n");
}

// A line whose parent already has an earlier child starts a new branch: the user rewound to the parent.
export function collectForkedMessageIds(lines: JSONLLine[]): Set<string> {
  const forkedMessageIds = new Set<string>();
  const parentsWithChild = new Set<string>();
  for (const line of lines) {
    if (line.uuid === undefined) {
      continue;
    }
    if (line.parentUuid === undefined || line.parentUuid === null) {
      continue;
    }
    const parentText = line.parentUuid.toString();
    if (parentsWithChild.has(parentText)) {
      forkedMessageIds.add(line.uuid.toString());
    }
    parentsWithChild.add(parentText);
  }
  return forkedMessageIds;
}

// A code rewind to a point before the file existed deletes the file; the transcript has no line for that deletion.
function removeFileRewoundAway(replayedFile: string): void {
  console.log(`assertSnapshotBackupsMatchState: rewind fork with a null backup, deleting ${replayedFile}`);
  rmSync(replayedFile);
}

function assertFileIsAbsent(replayedFile: string, line: JSONLLine, isRewindFork: boolean): void {
  const fileExists = existsSync(replayedFile);
  if (fileExists) {
    if (isRewindFork) {
      removeFileRewoundAway(replayedFile);
      return;
    }
    const actualText = readFileSync(replayedFile, "utf8");
    throw new Error(`assertSnapshotBackupsMatchState: ${replayedFile} exists but its backup is null, so it must not exist\n${createLineText(line)}\nreplayed text: ${JSON.stringify(actualText)}`);
  }
}

function assertFileEqualsBackup(replayedFile: string, backupFile: string, line: JSONLLine): void {
  const fileExists = existsSync(replayedFile);
  if (!fileExists) {
    throw new Error(`assertSnapshotBackupsMatchState: ${replayedFile} does not exist but backup ${backupFile} names it\n${createLineText(line)}`);
  }
  const actualBytes = readFileSync(replayedFile);
  const expectedBytes = readFileSync(backupFile);
  const isSame = actualBytes.equals(expectedBytes);
  if (!isSame) {
    throw new Error(createMismatchMessage(replayedFile, line, expectedBytes.toString("utf8"), actualBytes.toString("utf8")));
  }
}

export function clearSeenBackups(): void {
  lastSeenBackupTexts.clear();
}

// A snapshot line repeats the entries of earlier lines, so only a new or changed entry is checked.
function isNewOrChangedBackup(line: JSONLLine, replayedFile: string, backup: FileHistoryBackup): boolean {
  const sessionId = basename(getSourceOfLine(line).filePath, JSONL_EXTENSION);
  const seenKey = `${sessionId}\n${replayedFile}`;
  const backupText = `${backup.backupFileName?.toString()}\n${backup.version}\n${backup.backupTime.toISOString()}`;
  const isUnchanged = lastSeenBackupTexts.get(seenKey) === backupText;
  lastSeenBackupTexts.set(seenKey, backupText);
  return !isUnchanged;
}

// A Write/Edit applied early changed the disk, so the backup is compared with the content from before that write.
function assertBeforeContentIsAbsent(replayedFile: string, line: JSONLLine, beforeContent: BeforeContent): void {
  if (beforeContent === ABSENT_BEFORE_CONTENT) {
    return;
  }
  throw new Error(`assertSnapshotBackupsMatchState: ${replayedFile} existed before the pending write but its backup is null, so it must not exist\n${createLineText(line)}\ntext before the write: ${JSON.stringify(beforeContent.toString("utf8"))}`);
}

function assertBeforeContentEqualsBackup(replayedFile: string, backupFile: string, line: JSONLLine, beforeContent: BeforeContent): void {
  if (beforeContent === ABSENT_BEFORE_CONTENT) {
    throw new Error(`assertSnapshotBackupsMatchState: ${replayedFile} did not exist before the pending write but backup ${backupFile} names it\n${createLineText(line)}`);
  }
  const backupBytes = readFileSync(backupFile);
  const isSame = beforeContent.equals(backupBytes);
  if (!isSame) {
    throw new Error(createMismatchMessage(replayedFile, line, backupBytes.toString("utf8"), beforeContent.toString("utf8")));
  }
}

function assertBackupMatchesBeforeContent(replayedFile: string, line: JSONLLine, context: ScriptReplayContext, backup: FileHistoryBackup, beforeContent: BeforeContent): void {
  if (backup.backupFileName === null) {
    assertBeforeContentIsAbsent(replayedFile, line, beforeContent);
    return;
  }
  const backupFile = getBackupFilePath(context.fileHistoryPath, line, backup.backupFileName);
  assertBeforeContentEqualsBackup(replayedFile, backupFile, line, beforeContent);
}

function assertBackupMatchesDisk(replayedFile: string, line: JSONLLine, context: ScriptReplayContext, backup: FileHistoryBackup, isRewindFork: boolean): void {
  if (backup.backupFileName === null) {
    assertFileIsAbsent(replayedFile, line, isRewindFork);
    return;
  }
  const backupFile = getBackupFilePath(context.fileHistoryPath, line, backup.backupFileName);
  assertFileEqualsBackup(replayedFile, backupFile, line);
}

// With realParentDir the file is in that folder, whatever folder the session started in.
function getReplayedFile(state: Path, filePath: Path, backup: FileHistoryBackup): string {
  if (backup.realParentDir === undefined) {
    return resolve(state.toString(), filePath.toString());
  }
  return join(backup.realParentDir.toString(), basename(filePath.toString()));
}

function assertBackupMatchesFile(state: Path, line: JSONLLine, context: ScriptReplayContext, filePath: Path, backup: FileHistoryBackup, isRewindFork: boolean): void {
  const replayedFile = getReplayedFile(state, filePath, backup);
  const isChecked = isNewOrChangedBackup(line, replayedFile, backup);
  if (!isChecked) {
    return;
  }
  const beforeContent = findPendingBeforeContent(replayedFile);
  if (beforeContent !== undefined) {
    assertBackupMatchesBeforeContent(replayedFile, line, context, backup, beforeContent);
    return;
  }
  assertBackupMatchesDisk(replayedFile, line, context, backup, isRewindFork);
}

// Backup keys are relative to the session folder, which is the state folder; an absolute key stays as it is.
export function assertSnapshotBackupsMatchState(state: Path, line: JSONLLine, context: ScriptReplayContext): Path {
  const snapshotMessage = getFileHistorySnapshot(line);
  if (snapshotMessage === undefined) {
    throw new Error("assertSnapshotBackupsMatchState: the line is not a file-history snapshot");
  }
  const forkedMessageIds = context.forkedMessageIds ?? new Set<string>();
  const isRewindFork = forkedMessageIds.has(snapshotMessage.messageId.toString());
  for (const [filePath, backup] of snapshotMessage.snapshot.trackedFileBackups.listEntries()) {
    assertBackupMatchesFile(state, line, context, filePath, backup, isRewindFork);
  }
  return state;
}
