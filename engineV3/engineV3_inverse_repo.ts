// The inverse repo: one small bare git repo per file; its first commit is the file on disk now, each next commit is the next older known state.

import { mkdirSync } from "node:fs";

import { Path, Uuid } from "../src/structures/domain.ts";
import { runJfredGit } from "../src/viewer_api_layer1_jfred_git.ts";
import { executeGit, type CommitHash } from "./engineV3.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { FileEventType } from "./engineV3_replay_reverse_events.ts";

// position is the index in the full listKnownStatesForFile output; a smaller position is a newer state.
export type OrderedKnownState = { state: FileKnownState; position: number };

export type InverseCommit = {
  commitHash: CommitHash;
  treeHash: Uuid;
  position: number;
  eventType: FileEventType;
  moment: StateMoment;
  confidence: StateConfidence;
  instant: Date | undefined;
  jsonlPath: Path | undefined;
  line: number | undefined;
  isFileAbsent: boolean;
  removedByScript: boolean;
  movedAwayToFile: Path | undefined;
  text: string | undefined;
};

type StoredCommit = { commitHash: CommitHash; treeHash: Uuid; authorSeconds: number; message: string };
type ParsedMessage = { eventType: FileEventType; moment: StateMoment; confidence: StateConfidence; position: number; instant: Date | undefined; jsonlPath: Path | undefined; line: number | undefined; isFileAbsent: boolean; removedByScript: boolean; movedAwayToFile: Path | undefined };

// The keys of the one JSON object that is a commit message.
enum CommitMessageKey {
  JsonlPath = "jsonlPath",
  Line = "line",
  Timestamp = "timestamp",
  EventType = "eventType",
  Moment = "moment",
  Confidence = "confidence",
  Position = "position",
  IsFileAbsent = "isFileAbsent",
  SourceCommit = "sourceCommit",
  RemovedByScript = "removedByScript",
  MovedAwayToFile = "movedAwayToFile",
}

const FINAL_BRANCH = "refs/heads/inverse";
const BUILDING_BRANCH = "refs/heads/inverse-next";
const INITIAL_BRANCH_NAME = "inverse";
const COMMIT_IDENTITY_NAME = "jfred inverse repo";
const COMMIT_IDENTITY_EMAIL = "inverse-repo@jfred.invalid";
// const INSTANT_NOW_TEXT = "now";
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";

// The order in which buildInverseRepoByEventKind adds the groups.
enum InsertGroup {
  GitCommit,
  BackupSnapshot,
  ReadWhole,
  ProvenWriteOrEdit,
  ConfirmedOrDerived,
}

function parseEnumValue<T extends string>(enumObject: Record<string, T>, value: string): T {
  if (!(Object.values(enumObject) as string[]).includes(value)) {
    throw new Error(`parseEnumValue: ${value} is not one of ${Object.values(enumObject).join(", ")}`);
  }
  return value as T;
}

function formatCommitMessage(state: FileKnownState, position: number, instant: Date | undefined): string {
  const source = state.event.source;
  const fields = {
    [CommitMessageKey.JsonlPath]: source?.filePath ?? null,
    [CommitMessageKey.Line]: source?.lineNumber ?? null,
    [CommitMessageKey.Timestamp]: instant?.toISOString() ?? null,
    [CommitMessageKey.EventType]: state.event.type,
    [CommitMessageKey.Moment]: state.moment,
    [CommitMessageKey.Confidence]: state.confidence,
    [CommitMessageKey.Position]: position,
    [CommitMessageKey.IsFileAbsent]: state.isFileAbsent,
    [CommitMessageKey.SourceCommit]: state.event.commitHash?.toString() ?? null,
    [CommitMessageKey.RemovedByScript]: state.event.removedByScript,
    [CommitMessageKey.MovedAwayToFile]: state.event.movedAwayToFile?.toString() ?? null,
  };
  return JSON.stringify(fields);
}

function parseCommitMessage(message: string): ParsedMessage {
  const fields = JSON.parse(message) as Record<string, unknown>;
  const timestamp = fields[CommitMessageKey.Timestamp];
  let instant: Date | undefined;
  if (timestamp !== null) {
    instant = new Date(timestamp as string);
  }
  const jsonlPathText = fields[CommitMessageKey.JsonlPath];
  let jsonlPath: Path | undefined;
  if (jsonlPathText !== null) {
    jsonlPath = new Path(jsonlPathText as string);
  }
  const lineNumber = fields[CommitMessageKey.Line];
  let line: number | undefined;
  if (lineNumber !== null) {
    line = lineNumber as number;
  }
  const removedByScript = fields[CommitMessageKey.RemovedByScript];
  if (removedByScript === undefined) {
    throw new Error(`parseCommitMessage: the commit message has no ${CommitMessageKey.RemovedByScript}`);
  }
  const movedAwayToFileText = fields[CommitMessageKey.MovedAwayToFile];
  if (movedAwayToFileText === undefined) {
    throw new Error(`parseCommitMessage: the commit message has no ${CommitMessageKey.MovedAwayToFile}`);
  }
  let movedAwayToFile: Path | undefined;
  if (movedAwayToFileText !== null) {
    movedAwayToFile = new Path(movedAwayToFileText as string);
  }
  return {
    eventType: parseEnumValue(FileEventType, fields[CommitMessageKey.EventType] as string),
    moment: parseEnumValue(StateMoment, fields[CommitMessageKey.Moment] as string),
    confidence: parseEnumValue(StateConfidence, fields[CommitMessageKey.Confidence] as string),
    position: fields[CommitMessageKey.Position] as number,
    instant,
    jsonlPath,
    line,
    isFileAbsent: fields[CommitMessageKey.IsFileAbsent] as boolean,
    removedByScript: removedByScript as boolean,
    movedAwayToFile,
  };
}

// Writes the blobs and the tree of one state without a work tree; an absent file is the empty tree.
function writeStateTree(repoFolder: Path, fileName: string, state: FileKnownState): Uuid {
  if (state.isFileAbsent) {
    return new Uuid(runJfredGit(repoFolder, ["mktree"], { input: "" }));
  }
  if (state.text === undefined) {
    throw new Error(`writeStateTree: the ${state.event.type} state of ${fileName} is not absent and has no text`);
  }
  const blobHash = runJfredGit(repoFolder, ["hash-object", "-w", "--stdin"], { input: state.text });
  return new Uuid(runJfredGit(repoFolder, ["mktree"], { input: `100644 blob ${blobHash}\t${fileName}\n` }));
}

function writeCommit(repoFolder: Path, treeHash: Uuid, parent: CommitHash | undefined, message: string, authorSeconds: number): CommitHash {
  const dateText = `${authorSeconds} +0000`;
  const args = ["-c", "commit.gpgsign=false", "commit-tree", treeHash.toString()];
  if (parent !== undefined) {
    args.push("-p", parent.toString());
  }
  args.push("-m", message);
  const env = {
    GIT_AUTHOR_NAME: COMMIT_IDENTITY_NAME,
    GIT_AUTHOR_EMAIL: COMMIT_IDENTITY_EMAIL,
    GIT_AUTHOR_DATE: dateText,
    GIT_COMMITTER_NAME: COMMIT_IDENTITY_NAME,
    GIT_COMMITTER_EMAIL: COMMIT_IDENTITY_EMAIL,
    GIT_COMMITTER_DATE: dateText,
  };
  return new Uuid(runJfredGit(repoFolder, args, { env }));
}

function writeStateCommit(repoFolder: Path, fileName: string, orderedState: OrderedKnownState, parent: CommitHash | undefined, commitInstant: Date): CommitHash {
  const { state, position } = orderedState;
  let messageInstant: Date | undefined = commitInstant;
  if (state.event.type === FileEventType.DiskNow) {
    messageInstant = state.event.instant;
  }
  const treeHash = writeStateTree(repoFolder, fileName, state);
  const message = formatCommitMessage(state, position, messageInstant);
  return writeCommit(repoFolder, treeHash, parent, message, Math.floor(commitInstant.getTime() / 1000));
}

// First commit first.
function readStoredCommits(repoFolder: Path): StoredCommit[] {
  const format = ["%H", "%T", "%at", "%B"].join("%x1f") + "%x1e";
  const output = runJfredGit(repoFolder, ["log", "--reverse", `--format=${format}`, FINAL_BRANCH]);
  const storedCommits: StoredCommit[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    if (record.trim() !== "") {
      const [commitHash, treeHash, authorSeconds, message] = record.trim().split(FIELD_SEPARATOR) as [string, string, string, string];
      storedCommits.push({ commitHash: new Uuid(commitHash), treeHash: new Uuid(treeHash), authorSeconds: Number(authorSeconds), message: message.trim() });
    }
  }
  return storedCommits;
}

export function createInverseRepo(repoFolder: Path, fileName: string, diskNowState: OrderedKnownState, diskNowInstant: Date, onNewStateCommitted?: () => void): void {
  if (diskNowState.state.event.type !== FileEventType.DiskNow) {
    throw new Error(`createInverseRepo: the first state must be DiskNow, got ${diskNowState.state.event.type}`);
  }
  mkdirSync(repoFolder.toString(), { recursive: true });
  runJfredGit(repoFolder, ["init", "--bare", `--initial-branch=${INITIAL_BRANCH_NAME}`]);
  const rootCommit = writeStateCommit(repoFolder, fileName, diskNowState, undefined, diskNowInstant);
  runJfredGit(repoFolder, ["update-ref", FINAL_BRANCH, rootCommit.toString()]);
  onNewStateCommitted?.();
}

type MergeStep = { position: number; newState: OrderedKnownState | undefined; storedCommit: StoredCommit | undefined };

export function insertStatesIntoInverseRepo(repoFolder: Path, fileName: string, newStates: OrderedKnownState[], onNewStateCommitted?: () => void): void {
  const storedCommits = readStoredCommits(repoFolder);
  const steps: MergeStep[] = [];
  const takenPositions = new Set<number>();
  for (const storedCommit of storedCommits) {
    const position = parseCommitMessage(storedCommit.message).position;
    takenPositions.add(position);
    if (storedCommit !== storedCommits[0]) {
      steps.push({ position, newState: undefined, storedCommit });
    }
  }
  for (const newState of newStates) {
    if (takenPositions.has(newState.position)) {
      throw new Error(`insertStatesIntoInverseRepo: position ${newState.position} of ${fileName} already has a commit`);
    }
    takenPositions.add(newState.position);
    steps.push({ position: newState.position, newState, storedCommit: undefined });
  }
  steps.sort((leftStep, rightStep) => leftStep.position - rightStep.position);
  let parent = storedCommits[0]!.commitHash;
  for (const step of steps) {
    if (step.newState !== undefined) {
      const instant = step.newState.state.event.instant;
      if (instant === undefined) {
        throw new Error(`insertStatesIntoInverseRepo: the ${step.newState.state.event.type} state at position ${step.position} has no instant`);
      }
      parent = writeStateCommit(repoFolder, fileName, step.newState, parent, instant);
      onNewStateCommitted?.();
    } else {
      const stored = step.storedCommit!;
      parent = writeCommit(repoFolder, stored.treeHash, parent, stored.message, stored.authorSeconds);
    }
  }
  runJfredGit(repoFolder, ["update-ref", BUILDING_BRANCH, parent.toString()]);
  runJfredGit(repoFolder, ["update-ref", FINAL_BRANCH, parent.toString()]);
  runJfredGit(repoFolder, ["update-ref", "-d", BUILDING_BRANCH]);
}

function getInsertGroup(state: FileKnownState): InsertGroup | undefined {
  if (state.confidence === StateConfidence.Unknown) {
    return undefined;
  }
  switch (state.event.type) {
    case FileEventType.GitCommit:
      return InsertGroup.GitCommit;
    case FileEventType.BackupSnapshot:
      return InsertGroup.BackupSnapshot;
    case FileEventType.ReadWhole:
      return InsertGroup.ReadWhole;
    case FileEventType.WriteRow:
    case FileEventType.EditRow:
      if (state.confidence === StateConfidence.Proven) {
        return InsertGroup.ProvenWriteOrEdit;
      }
      return InsertGroup.ConfirmedOrDerived;
    default:
      return InsertGroup.ConfirmedOrDerived;
  }
}

// states is the full listKnownStatesForFile output, newest first, so states[0] is the disk-now state.
export function buildInverseRepoByEventKind(repoFolder: Path, fileName: string, states: FileKnownState[], diskNowInstant: Date, onNewStateCommitted?: () => void): void {
  createInverseRepo(repoFolder, fileName, { state: states[0]!, position: 0 }, diskNowInstant, onNewStateCommitted);
  const groups: OrderedKnownState[][] = [[], [], [], [], []];
  for (const [position, state] of states.entries()) {
    if (position > 0) {
      const group = getInsertGroup(state);
      if (group !== undefined) {
        groups[group]!.push({ state, position });
      }
    }
  }
  for (const group of groups) {
    if (group.length > 0) {
      insertStatesIntoInverseRepo(repoFolder, fileName, group, onNewStateCommitted);
    }
  }
}

// First commit first, which is the newest moment first.
// export function listInverseCommits(repoFolder: Path, fileName: string): InverseCommit[] {
export function listInverseCommits(repoFolder: Path, fileName: string, isTextRead: boolean = true): InverseCommit[] {
  const inverseCommits: InverseCommit[] = [];
  for (const storedCommit of readStoredCommits(repoFolder)) {
    const parsed = parseCommitMessage(storedCommit.message);
    let text: string | undefined;
    if (isTextRead) {
      if (!parsed.isFileAbsent) {
        text = executeGit(repoFolder, ["cat-file", "blob", `${storedCommit.commitHash.toString()}:${fileName}`]).toString("utf8");
      }
    }
    inverseCommits.push({ commitHash: storedCommit.commitHash, treeHash: storedCommit.treeHash, ...parsed, text });
  }
  return inverseCommits;
}
