// Copies of the engineV3.ts apply functions that write the state folder on disk.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getBeaconSnippet, getUserEditEvent, type BeaconSnippet } from "../src/reconstruction_user_edit.ts";
import { isBeaconElided } from "../src/reconstruction_beacons_elided_match.ts";
import { convertToProjectRelativePath } from "../src/layer1_snapshot_wire.ts";
import { convertEditResult, convertWriteResult } from "../src/structures/tool-result-shapes.ts";
import { splitLines } from "../src/reconstruction_replay_edit.ts";
import { isHunkMatchingBase, applyHunksToLines } from "../src/layer1_edit_hunks.ts";
import type { StructuredPatchHunk } from "../src/structures/tool-result-shapes.ts";
import { JSONLLineKind, getJSONLLineKind, type CommitHash, type JSONLLine } from "./engineV3.ts";
import { applyChangesToState, listChangesInCommit, writeFileIntoState } from "./engineV3_replay_submodule.ts";
import { decideFinalNewline, stripNewlineMarkerRows } from "./engineV3_replay_newline.ts";
import { addWorktreeToState } from "./engineV3_replay_worktree.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
import { getReplayRoot } from "./engineV3_replay_root.ts";
import { assertSnapshotBackupsMatchState } from "./engineV3_replay_backups.ts";
import { isAppliedWriteEditResult, listWriteEditCallIds } from "./engineV3_replay_tool_results.ts";
import { removePendingWrite, addPendingWrite, findPendingBeforeContent, findResultOriginalFile, findWrittenFile } from "./engineV3_replay_pending_writes.ts";
import { getFileHistorySnapshot } from "../src/structures/file-history.ts";
import { getRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";

// const NO_NEWLINE_MARKER_PREFIX = "\\";

// Writes the commit's changes into the state folder, like a cherry-pick of that one commit.
export function applyCommitToState(commit: CommitHash, state: Path, repoPath: Path): Path {
  const changes = listChangesInCommit(commit, repoPath);
  applyChangesToState(changes, commit.toString(), state, repoPath);
  return state;
}

function getRepoRelativePath(repo: Path, absolutePath: Path): Path {
  const relativePath = convertToProjectRelativePath(repo, absolutePath.toString());
  if (relativePath === undefined) {
    throw new Error(`getRepoRelativePath: ${absolutePath.toString()} is outside the repo ${repo.toString()}`);
  }
  return new Path(relativePath);
}

function applyWriteCreateToState(state: Path, line: JSONLLine): Path {
  const result = convertWriteResult(line.toolUseResult);
  const root = getReplayRoot(state, result.filePath);
  const relativePath = getRepoRelativePath(root, result.filePath);
  writeFileIntoState(root, relativePath, Buffer.from(result.content, "utf8"));
  return state;
}

function applyEditToState(state: Path, line: JSONLLine): Path {
  const result = convertEditResult(line.toolUseResult);
  const root = getReplayRoot(state, result.filePath);
  const relativePath = getRepoRelativePath(root, result.filePath);
  writeFileIntoState(root, relativePath, Buffer.from(result.newString, "utf8"));
  return state;
}

// Keeps the file's old ending: the snippet has no final newline.
function applyUserEditToState(state: Path, line: JSONLLine): Path {
  const event = getUserEditEvent(line);
  if (event === undefined) {
    throw new Error("applyUserEditToState: line is not an edited_text_file attachment");
  }
  const root = getReplayRoot(state, event.target);
  const relativePath = getRepoRelativePath(root, event.target);
  const oldBytes = readFileSync(join(root.toString(), relativePath.toString()));
  const oldText = oldBytes.toString("utf8");
  const trailingNewline = oldText.endsWith("\n") ? "\n" : "";
  const snippet = getBeaconSnippet([line], event.changeId)!;
  if (isBeaconElided(snippet)) {
    const newText = patchWindowIntoText(oldText, snippet) + trailingNewline;
    writeFileIntoState(root, relativePath, Buffer.from(newText, "utf8"));
    return state;
  }
  writeFileIntoState(root, relativePath, Buffer.from(event.content + trailingNewline, "utf8"));
  return state;
}

// Replaces only the file lines the window snippet shows; the gap lines and the lines after it stay.
function patchWindowIntoText(oldText: string, snippet: BeaconSnippet): string {
  const fileLines = splitLines(oldText);
  // When the numbers restart (a line number at or below the line before it), the later chunk is the file tail numbered by the harness's older copy: it ends on the file's last line.
  const lastSnippetLineNo = snippet.lines[snippet.lines.length - 1]!.lineNo;
  let chunkShift = 0;
  let previousLineNo = 0;
  for (const { lineNo, text } of snippet.lines) {
    if (lineNo <= previousLineNo) {
      chunkShift = fileLines.length - lastSnippetLineNo;
    }
    previousLineNo = lineNo;
    const targetLineNo = lineNo + chunkShift;
    if (targetLineNo - 1 > fileLines.length) {
      throw new Error(`patchWindowIntoText: snippet line ${lineNo} is past the end of a ${fileLines.length}-line file`);
    }
    fileLines[targetLineNo - 1] = text;
  }
  return fileLines.join("\n");
}

// function containsNoNewlineMarker(hunkLines: string[]): boolean {
//   for (const row of hunkLines) {
//     const isMarker = row.startsWith(NO_NEWLINE_MARKER_PREFIX);
//     if (isMarker) {
//       return true;
//     }
//   }
//   return false;
// }

function assertHunksMatchBase(base: string[], hunks: StructuredPatchHunk[], filePath: string): void {
  for (const hunk of hunks) {
    const isMatching = isHunkMatchingBase(base, hunk);
    if (!isMatching) {
      throw new Error(`applyPartialEditToState: hunk does not match originalFile for ${filePath}`);
    }
  }
}

function applyPartialEditToState(state: Path, line: JSONLLine): Path {
  const result = convertEditResult(line.toolUseResult);
  const filePath = result.filePath.toString();
  if (result.originalFile === null) {
    throw new Error(`applyPartialEditToState: no originalFile for ${filePath}`);
  }
  const base = splitLines(result.originalFile);
  const hunks = stripNewlineMarkerRows(result.structuredPatch);
  assertHunksMatchBase(base, hunks, filePath);
  const newLines = applyHunksToLines(base, hunks);
  const originalHasFinalNewline = result.originalFile.endsWith("\n");
  const hasFinalNewline = decideFinalNewline(result.structuredPatch, originalHasFinalNewline);
  const trailingNewline = hasFinalNewline ? "\n" : "";
  const text = newLines.join("\n") + trailingNewline;
  const root = getReplayRoot(state, result.filePath);
  const relativePath = getRepoRelativePath(root, result.filePath);
  writeFileIntoState(root, relativePath, Buffer.from(text, "utf8"));
  return state;
}

// The result's originalFile is the real file text just before the call, so a difference from the replayed file is a user hand edit.
function learnHandEditFromResult(state: Path, resultLine: JSONLLine): void {
  const file = findWrittenFile(state, resultLine);
  if (file === undefined) {
    return;
  }
  const originalFile = findResultOriginalFile(state, resultLine);
  if (originalFile === null) {
    return;
  }
  const originalBytes = Buffer.from(originalFile, "utf8");
  if (existsSync(file)) {
    if (readFileSync(file).equals(originalBytes)) {
      return;
    }
  }
  const source = getRecordSource(resultLine) as RecordSource;
  console.log(`learned hand edit: ${file} from originalFile at JSONL line: ${source.filePath}:${source.lineNumber}`);
  const root = getReplayRoot(state, new Path(file));
  const relativePath = getRepoRelativePath(root, new Path(file));
  writeFileIntoState(root, relativePath, originalBytes);
}

// A snapshot can sit before the call line; its messageId is the call's message, and the results of that message have that message as parent.
function learnHandEditsForSnapshot(state: Path, line: JSONLLine, context: ScriptReplayContext): void {
  const snapshotMessage = getFileHistorySnapshot(line);
  if (snapshotMessage === undefined) {
    throw new Error("learnHandEditsForSnapshot: the line is not a file-history snapshot");
  }
  const learnedFiles = new Set<string>();
  for (const resultLine of context.writeEditResultLines.values()) {
    if (resultLine.parentUuid?.toString() !== snapshotMessage.messageId.toString()) {
      continue;
    }
    const file = findWrittenFile(state, resultLine);
    if (file === undefined) {
      continue;
    }
    // Only the first result per file: a later result's originalFile includes the earlier write.
    if (learnedFiles.has(file)) {
      continue;
    }
    learnedFiles.add(file);
    // A pending write was applied early, so the file already holds the write.
    if (findPendingBeforeContent(file) !== undefined) {
      continue;
    }
    learnHandEditFromResult(state, resultLine);
  }
}

// The state folder has the Mac repo path, so it is the path base for lines.
export function applyJSONLLineToState(state: Path, line: JSONLLine, snapshotPaths: Path[], context: ScriptReplayContext): Path {
  for (const callId of listWriteEditCallIds(line)) {
    const resultLine = context.writeEditResultLines.get(callId);
    if (resultLine !== undefined) {
      learnHandEditFromResult(state, resultLine);
      addPendingWrite(state, resultLine);
      applyLineByKind(state, resultLine, context);
    }
  }
  const isAppliedResult = isAppliedWriteEditResult(line, context.writeEditResultLines);
  if (isAppliedResult) {
    removePendingWrite(state, line);
    return state;
  }
  return applyLineByKind(state, line, context);
}

function applyLineByKind(state: Path, line: JSONLLine, context: ScriptReplayContext): Path {
  const kind = getJSONLLineKind(line, state);
  switch (kind) {
    case JSONLLineKind.WriteCreate: return applyWriteCreateToState(state, line);
    case JSONLLineKind.EditWholeFile: return applyEditToState(state, line);
    case JSONLLineKind.WriteUpdate: return applyWriteCreateToState(state, line);
    case JSONLLineKind.EditPartial: return applyPartialEditToState(state, line);
    // case JSONLLineKind.Snapshot: throw new Error("snapshot lines with backups are not supported yet");
    case JSONLLineKind.Snapshot: {
      learnHandEditsForSnapshot(state, line, context);
      return assertSnapshotBackupsMatchState(state, line, context);
    }
    case JSONLLineKind.WorktreeAdd: return addWorktreeToState(state, line);
    case JSONLLineKind.Script: return executeScriptInState(state, line, context);
    case JSONLLineKind.UserEdit: return applyUserEditToState(state, line);
    case JSONLLineKind.Skip: return state;
    default: throw new Error(`applyJSONLLineToState: no replay yet for kind ${kind}`);
  }
}
