// Copies of the engineV3.ts apply functions that write the state folder on disk.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { getUserEditEvent } from "../src/reconstruction_user_edit.ts";
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
import { removePendingWrite, addPendingWrite } from "./engineV3_replay_pending_writes.ts";

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
  const trailingNewline = oldBytes.toString("utf8").endsWith("\n") ? "\n" : "";
  writeFileIntoState(root, relativePath, Buffer.from(event.content + trailingNewline, "utf8"));
  return state;
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

// The state folder has the Mac repo path, so it is the path base for lines.
export function applyJSONLLineToState(state: Path, line: JSONLLine, snapshotPaths: Path[], context: ScriptReplayContext): Path {
  for (const callId of listWriteEditCallIds(line)) {
    const resultLine = context.writeEditResultLines.get(callId);
    if (resultLine !== undefined) {
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
    case JSONLLineKind.Snapshot: return assertSnapshotBackupsMatchState(state, line, context);
    case JSONLLineKind.WorktreeAdd: return addWorktreeToState(state, line);
    case JSONLLineKind.Script: return executeScriptInState(state, line, context);
    case JSONLLineKind.UserEdit: return applyUserEditToState(state, line);
    case JSONLLineKind.Skip: return state;
    default: throw new Error(`applyJSONLLineToState: no replay yet for kind ${kind}`);
  }
}
