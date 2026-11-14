// Layer 1's reverse-walk vocabulary on the wire: one file's states from now back to the oldest known state.

// Mirrors ReverseStateKind in engineV3/engineV3_replay_reverse.ts; the webapp cannot import from engineV3.
export const WireReverseKind = {
  DiskNow: "DiskNow",
  EditUndone: "EditUndone",
  WriteUndone: "WriteUndone",
  FileCreated: "FileCreated",
  UnknownChange: "UnknownChange",
  ScriptChange: "ScriptChange",
  GitCommit: "GitCommit",
  BackupSnapshot: "BackupSnapshot",
  ReadOnly: "ReadOnly",
  PossibleChange: "PossibleChange",
} as const;
export type WireReverseKind = (typeof WireReverseKind)[keyof typeof WireReverseKind];

// index 0 is now, larger is older; instant is absent for DiskNow; content absent means the file did not exist.
export interface WireReverseStateOf<I, P> {
  index: number;
  kind: WireReverseKind;
  instant?: I;
  content?: string;
  jsonlPath?: P;
  lineNumber?: number;
  commitHash?: string;
  isModifying?: boolean;
}

export interface WireReverseWalkOf<I, P> {
  path: string;
  states: WireReverseStateOf<I, P>[];
}

export type WireReverseState = WireReverseStateOf<string, string>;
export type WireReverseWalk = WireReverseWalkOf<string, string>;
