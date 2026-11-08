import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RepoState, readRepoState } from "../src/engine_v3_repo_state.ts";
import { copyProjectAtCommit } from "../src/reconstruction_script_sandbox_project.ts";
import assert from "node:assert";
import { RecordType } from "../src/structures/vocabulary.ts";
import { getFileHistorySnapshot } from "../src/structures/file-history.ts";
import { convertEditResult, convertWriteResult } from "../src/structures/tool-result-shapes.ts";
import { convertToProjectRelativePath } from "../src/layer1_snapshot_wire.ts";
import { splitLines } from "../src/reconstruction_replay_edit.ts";
import { isHunkMatchingBase, applyHunksToLines } from "../src/layer1_edit_hunks.ts";
import { findWorktreeAgentId } from "./engineV3_replay_worktree.ts";
import { findScriptRun } from "./engineV3_replay_script.ts";

//fill these in or import them from the other engine versions
// type RepoState = {
//     // Define the structure of the repository state here
// };

export type CommitHash = Uuid;
// type CommitHash = {
//     //operator for incrementing the commit hash
//
// };

// type Path = {
//
// };
export type JSONLLine = TranscriptRecord;
// type JSONLLine = {
//
// };

type CommitChange = { status: string; path: Path };

const DELETED_STATUS = "D";
const BLOB_STATUSES = ["A", "M", "T"];

export function executeGit(repo: Path, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: repo.toString(), maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repo.toString()}: ${result.stderr}`);
  }
  return result.stdout;
}

function listChangesInCommit(commit: CommitHash, repo: Path): CommitChange[] {
  const args = ["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", "--root", "--diff-merges=first-parent", "--name-status", commit.toString()];
  const output = executeGit(repo, args);
  const text = output.toString("utf8");
  const tokens = text.split("\0");
  tokens.pop();
  const changes: CommitChange[] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    changes.push({ status: tokens[index] as string, path: new Path(tokens[index + 1] as string) });
  }
  return changes;
}

function applyChangeToState(change: CommitChange, commit: CommitHash, state: RepoState, repo: Path): void {
  if (change.status === DELETED_STATUS) {
    state.removePath(change.path);
    return;
  }
  const isBlobStatus = BLOB_STATUSES.includes(change.status);
  if (isBlobStatus) {
    state.set(change.path, executeGit(repo, ["cat-file", "blob", `${commit.toString()}:${change.path.toString()}`]));
    return;
  }
  throw new Error(`applyCommitToState: unsupported change status ${change.status} for ${change.path.toString()}`);
}

// Applies the commit's changes to `state` in place, like a cherry-pick of that one commit.
export function applyCommitToState(commit: CommitHash, state: RepoState, repo: Path): RepoState {
  for (const change of listChangesInCommit(commit, repo)) {
    applyChangeToState(change, commit, state, repo);
  }
  return state;
}

export const CHECKOUT_FOLDER_PREFIX = "engine-v3-checkout-";

export function checkOutRepoAt(repo: Path, commit: CommitHash): RepoState {
  const checkoutFolder = new Path(mkdtempSync(join(tmpdir(), CHECKOUT_FOLDER_PREFIX)));
  try {
    copyProjectAtCommit(repo, commit, checkoutFolder);
    return readRepoState(checkoutFolder);
  }
  finally {
    rmSync(checkoutFolder.toString(), { recursive: true, force: true });
  }
}

// Exit code 0 means ancestor, 1 means not an ancestor; anything else throws.
function isAncestorOrEqual(repo: Path, ancestor: CommitHash, descendant: CommitHash): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor.toString(), descendant.toString()], { cwd: repo.toString() });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(`git merge-base --is-ancestor failed in ${repo.toString()}: ${result.stderr}`);
}

function listChildCommits(repo: Path, commit: CommitHash): CommitHash[] {
  const output = executeGit(repo, ["rev-list", "--all", "--children"]);
  const text = output.toString("utf8");
  for (const line of text.split("\n")) {
    const [parent, ...childNames] = line.split(" ");
    const isParentCommit = parent === commit.toString();
    if (isParentCommit) {
      return convertToCommitHashes(childNames);
    }
  }
  return [];
}

function convertToCommitHashes(names: string[]): CommitHash[] {
  const hashes: CommitHash[] = [];
  for (const name of names) {
    hashes.push(new Uuid(name));
  }
  return hashes;
}

export function getChildCommitTowards(repo: Path, currentCommit: CommitHash, endingCommit: CommitHash): CommitHash | undefined {
  const children = listChildCommits(repo, currentCommit);
  for (const child of children) {
    const isChildOnTheWay = isAncestorOrEqual(repo, child, endingCommit);
    if (isChildOnTheWay) {
      return child;
    }
  }
  return children[0];
}

export function isCommitAtOrBefore(repo: Path, commit: CommitHash | undefined, endingCommit: CommitHash): commit is CommitHash {
  if (commit === undefined) {
    return false;
  }
  return isAncestorOrEqual(repo, commit, endingCommit);
}

// What replaying one JSONL line does to the state.
export enum JSONLLineKind {
  WriteCreate = "WriteCreate",
  EditWholeFile = "EditWholeFile",
  WriteUpdate = "WriteUpdate",
  EditPartial = "EditPartial",
  // OriginalFile = "OriginalFile",
  Snapshot = "Snapshot",
  WorktreeAdd = "WorktreeAdd",
  Script = "Script",
  Skip = "Skip",
}

const WRITE_RESULT_TYPE_CREATE = "create";
const WRITE_RESULT_TYPE_UPDATE = "update";

// The line's toolUseResult as an object, or undefined when there is none.
function getToolResultObject(line: JSONLLine): Record<string, unknown> | undefined {
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
  return raw as Record<string, unknown>;
}

// One line has no tool-name map, so the result shape tells Edit and Write apart.
function isEditResultShape(raw: Record<string, unknown>): boolean {
  const hasOldString = "oldString" in raw;
  const hasFilePath = "filePath" in raw;
  const hasOriginalFile = "originalFile" in raw;
  if (!hasOldString) {
    return false;
  }
  if (!hasFilePath) {
    return false;
  }
  return hasOriginalFile;
}

function isWriteResultShape(raw: Record<string, unknown>): boolean {
  const hasContent = typeof raw.content === "string";
  const hasFilePath = "filePath" in raw;
  const hasOriginalFile = "originalFile" in raw;
  if (!hasContent) {
    return false;
  }
  if (!hasFilePath) {
    return false;
  }
  return hasOriginalFile;
}

// function isInsideRepo(repo: Path, absolutePath: Path): boolean {
//   return convertToProjectRelativePath(repo, absolutePath.toString()) !== undefined;
// }

function getRepoRelativePath(repo: Path, absolutePath: Path): Path {
  const relativePath = convertToProjectRelativePath(repo, absolutePath.toString());
  if (relativePath === undefined) {
    throw new Error(`getRepoRelativePath: ${absolutePath.toString()} is outside the repo ${repo.toString()}`);
  }
  return new Path(relativePath);
}

function getWriteResultKind(raw: Record<string, unknown>, repo: Path): JSONLLineKind {
  const result = convertWriteResult(raw);
  const isInRepo = convertToProjectRelativePath(repo, result.filePath.toString()) !== undefined;
  if (!isInRepo) {
    return JSONLLineKind.Skip;
  }
  if (result.type === WRITE_RESULT_TYPE_CREATE) {
    return JSONLLineKind.WriteCreate;
  }
  if (result.type === WRITE_RESULT_TYPE_UPDATE) {
    return JSONLLineKind.WriteUpdate;
  }
  throw new Error(`getJSONLLineKind: unknown Write result type ${result.type}`);
}

// function getOriginalFileKind(originalFile: string | null): JSONLLineKind {
//   if (originalFile === null) {
//     return JSONLLineKind.Skip;
//   }
//   return JSONLLineKind.OriginalFile;
// }

function getEditResultKind(raw: Record<string, unknown>, repo: Path): JSONLLineKind {
  const result = convertEditResult(raw);
  const isInRepo = convertToProjectRelativePath(repo, result.filePath.toString()) !== undefined;
  if (!isInRepo) {
    return JSONLLineKind.Skip;
  }
  if (result.oldString === result.originalFile) {
    return JSONLLineKind.EditWholeFile;
  }
  if (result.originalFile === null) {
    return JSONLLineKind.Skip;
  }
  return JSONLLineKind.EditPartial;
}

function getSnapshotKind(line: JSONLLine): JSONLLineKind {
  const snapshotMessage = getFileHistorySnapshot(line);
  if (snapshotMessage === undefined) {
    throw new Error("getJSONLLineKind: snapshot record could not be read");
  }
  const hasBackups = snapshotMessage.snapshot.trackedFileBackups.size > 0;
  if (hasBackups) {
    return JSONLLineKind.Snapshot;
  }
  return JSONLLineKind.Skip;
}

function getToolResultKind(raw: Record<string, unknown>, repo: Path): JSONLLineKind {
  const isEditResult = isEditResultShape(raw);
  if (isEditResult) {
    return getEditResultKind(raw, repo);
  }
  const isWriteResult = isWriteResultShape(raw);
  if (isWriteResult) {
    return getWriteResultKind(raw, repo);
  }
  return JSONLLineKind.Skip;
}

function getToolResultLineKind(line: JSONLLine, repo: Path): JSONLLineKind {
  const raw = getToolResultObject(line);
  if (raw === undefined) {
    return JSONLLineKind.Skip;
  }
  return getToolResultKind(raw, repo);
}

export function getJSONLLineKind(line: JSONLLine, repo: Path): JSONLLineKind {
  if (line.type === RecordType.fileHistorySnapshot) {
    return getSnapshotKind(line);
  }
  const worktreeAgentId = findWorktreeAgentId(line);
  if (worktreeAgentId !== undefined) {
    return JSONLLineKind.WorktreeAdd;
  }
  const scriptRun = findScriptRun(line);
  if (scriptRun !== undefined) {
    return JSONLLineKind.Script;
  }
  return getToolResultLineKind(line, repo);
}

function applyWriteCreateToState(state: RepoState, line: JSONLLine, repo: Path): RepoState {
  const result = convertWriteResult(line.toolUseResult);
  state.set(getRepoRelativePath(repo, result.filePath), Buffer.from(result.content, "utf8"));
  return state;
}

function applyEditToState(state: RepoState, line: JSONLLine, repo: Path): RepoState {
  const result = convertEditResult(line.toolUseResult);
  state.set(getRepoRelativePath(repo, result.filePath), Buffer.from(result.newString, "utf8"));
  return state;
}

// function applyOriginalFileToState(state: RepoState, line: JSONLLine, repo: Path): RepoState {
//   const raw = line.toolUseResult as Record<string, unknown>;
//   const result = isEditResultShape(raw) ? convertEditResult(raw) : convertWriteResult(raw);
//   if (result.originalFile === null) {
//     throw new Error(`applyOriginalFileToState: no originalFile for ${result.filePath.toString()}`);
//   }
//   state.set(getRepoRelativePath(repo, result.filePath), Buffer.from(result.originalFile, "utf8"));
//   return state;
// }

function applyPartialEditToState(state: RepoState, line: JSONLLine, repo: Path): RepoState {
  const result = convertEditResult(line.toolUseResult);
  const filePath = result.filePath.toString();
  if (result.originalFile === null) {
    throw new Error(`applyPartialEditToState: no originalFile for ${filePath}`);
  }
  const base = splitLines(result.originalFile);
  for (const hunk of result.structuredPatch) {
    const hasNoNewlineMarker = hunk.lines.some((row) => row.startsWith("\\"));
    if (hasNoNewlineMarker) {
      throw new Error(`applyPartialEditToState: no-newline marker not supported in ${filePath}`);
    }
    const isMatching = isHunkMatchingBase(base, hunk);
    if (!isMatching) {
      throw new Error(`applyPartialEditToState: hunk does not match originalFile for ${filePath}`);
    }
  }
  const newLines = applyHunksToLines(base, result.structuredPatch);
  // ponytail: trailing newline copied from originalFile; an Edit that changes the last newline is not handled.
  const trailingNewline = result.originalFile.endsWith("\n") ? "\n" : "";
  const text = newLines.join("\n") + trailingNewline;
  state.set(getRepoRelativePath(repo, result.filePath), Buffer.from(text, "utf8"));
  return state;
}

// Mutates `state` and returns it, like applyCommitToState.
export function applyJSONLLineToState(state: RepoState, line: JSONLLine, snapshotPaths: Path[], repo: Path): RepoState {
  const kind = getJSONLLineKind(line, repo);
  switch (kind) {
    case JSONLLineKind.WriteCreate: return applyWriteCreateToState(state, line, repo);
    case JSONLLineKind.EditWholeFile: return applyEditToState(state, line, repo);
    case JSONLLineKind.WriteUpdate: return applyWriteCreateToState(state, line, repo);
    case JSONLLineKind.EditPartial: return applyPartialEditToState(state, line, repo);
    // case JSONLLineKind.OriginalFile: return applyOriginalFileToState(state, line, repo);
    case JSONLLineKind.Snapshot: throw new Error("snapshot lines with backups are not supported yet");
    // case JSONLLineKind.Script: return runScriptInRepo(state, line);  // scripts come later
    case JSONLLineKind.Skip: return state;
    default: throw new Error(`applyJSONLLineToState: no replay yet for kind ${kind}`);
  }
}

export enum TimelineEventKind {
  GitCommit = "GitCommit",
  JSONLLine = "JSONLLine",
}

export type TimelineEvent =
  | { type: TimelineEventKind.GitCommit; commit: CommitHash; timestamp: number }
  | { type: TimelineEventKind.JSONLLine; line: JSONLLine; timestamp: number };

export type JSONLAndGitEvents = TimelineEvent[];

export function logJSONLLineEvent(line: JSONLLine, repo: Path): void {
  const kind = getJSONLLineKind(line, repo);
  const outcome = kind === JSONLLineKind.Skip ? "skipped" : "replayed";
  console.log(`${line.type} ${kind} ${outcome}`);
}

// Applies events startIndex up to, but not including, endIndex.
export function createGitCommitForRange(allTimelineEvents: JSONLAndGitEvents, startIndex: number, endIndex: number, snapshotPaths: Path[], repoPath: Path, startingState: RepoState): RepoState {
  let state = startingState;
  assert(startIndex <= endIndex);
  let index = startIndex;
  let lastTimestamp = -1;
  while (index < endIndex) {
    const event = allTimelineEvents[index] as TimelineEvent;
    if (event.type === TimelineEventKind.GitCommit) {
      console.log(`commit ${event.commit.toString()} replayed`);
      state = applyCommitToState(event.commit, state, repoPath);
    }
    else {
      logJSONLLineEvent(event.line, repoPath);
      state = applyJSONLLineToState(state, event.line, snapshotPaths, repoPath);
    }
    index++;
    lastTimestamp = event.timestamp;
  }
  return state;
}

export function runReplay(repoState:RepoState, startingCommit: CommitHash, endingCommit: CommitHash, repo:Path, snapshots?:Path[], events?:JSONLLine[]) : RepoState {
  let currentCommit: CommitHash | undefined = startingCommit;
  let currentState = repoState;
  do {
    currentState = applyCommitToState(currentCommit, currentState, repo);
    currentCommit = getChildCommitTowards(repo, currentCommit, endingCommit);
  } while( isCommitAtOrBefore(repo, currentCommit, endingCommit) );

  return currentState;
}
