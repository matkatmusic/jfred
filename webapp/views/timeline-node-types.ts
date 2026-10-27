import type { LineNode } from "./timeline-line-nodes.ts";
import type { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND } from "./timeline-types.ts";
import type { WireScriptRun, WireGitOperation, WireStepSnapshot } from "./timeline-wire-types.ts";

// buildRevisionIndex maps a changeId to its revision facts; displayPath is the name at that revision.
export type RevisionIndexEntry = {
  path: string;
  displayPath: string;
  eventKind: string;
  renamedFrom: string | undefined;
  isFirstRevision: boolean;
  isRewound: boolean;
};
export type RevisionIndex = Map<string, RevisionIndexEntry>;

// One chip per path from computeFileChanges; `when` is the snapshot's instant.
export type FileChange = {
  path: string;
  displayPath: string;
  eventKind: string;
  renamedFrom: string | undefined;
  isFirstRevision: boolean;
  changeId: string | undefined;
  when: string;
};

// The (sessionId, when) instant snapshot ownership is decided on (checkNodeCanOwnSnapshot).
export type SnapshotInstant = { sessionId?: string; when: string };

// A raw transcript position the inspector can open: (jsonl, its lines, 0-based line index).
export type TranscriptLocation = { jsonlName: string; rawLines: string[]; line: number };

// One conversation turn; synthetic trailing turns lack fields that are stamped after sorting.
export type TurnNode = {
  kind: typeof USER_TURN_NODE_KIND | typeof AGENT_TURN_NODE_KIND;
  when: string;
  sessionId: string | undefined;
  uuid?: string;
  text: string;
  isSystem?: boolean;
  snapshots: WireStepSnapshot[];
  gitOperations: WireGitOperation[];
  stepNumber?: number;
  fileChanges?: FileChange[];
  isOrphaned?: boolean;
  // True on the synthetic turn holding the git-derived baseline; the role pill reads "git-derived baseline".
  isGitBaseline?: boolean;
  detail?: undefined;
  resultHash?: undefined;
  isError?: undefined;
  summary?: undefined;
  toolName?: undefined;
  toolUseId?: undefined;
  scriptRun?: undefined;
};

// One session-end terminator per session (appendSessionEndNodes).
export type SessionEndNode = {
  kind: typeof SESSION_END_NODE_KIND;
  when: string;
  sessionId: string;
  snapshots: WireStepSnapshot[];
  stepNumber?: number;
  fileChanges?: FileChange[];
  isOrphaned?: boolean;
  isGitBaseline?: undefined;
  uuid?: undefined;
  text?: undefined;
  isSystem?: undefined;
  gitOperations?: undefined;
  detail?: undefined;
  resultHash?: undefined;
  isError?: undefined;
  summary?: undefined;
  toolName?: undefined;
  toolUseId?: undefined;
  scriptRun?: undefined;
};

// One git-commit hard stop (buildCommitNodes); never numbered, never pickable.
export type CommitNode = {
  kind: typeof COMMIT_NODE_KIND;
  when: string;
  sessionId: string | undefined;
  detail?: string;
  // The commit's short hash; the fork layout's `GIT COMMIT [hash]` pill.
  resultHash?: string;
  // True when the commit command's tool_result errored; drives the row's FAILED badge.
  isError?: boolean;
  // The base-commit row absorbs the git-baseline flag, summary, snapshots, and file chips.
  isGitBaseline?: boolean;
  text?: string;
  snapshots?: WireStepSnapshot[];
  fileChanges?: FileChange[];
  uuid?: undefined;
  isSystem?: undefined;
  gitOperations?: undefined;
  stepNumber?: undefined;
  isOrphaned?: undefined;
  summary?: undefined;
  toolName?: undefined;
  toolUseId?: undefined;
  scriptRun?: undefined;
};

// One un-bubbled tool-call row; never numbered or pickable, sorts chronologically among turns.
export type ToolCallNode = {
  kind: typeof TOOL_CALL_NODE_KIND;
  when: string;
  sessionId: string | undefined;
  uuid: string;
  toolName: string;
  summary: string;
  toolUseId: string;
  // Copied from the engine's per-record wire stamp; a tool row on a rewound branch dims too.
  isOrphaned?: boolean;
  // True when this row's Bash call is a failed git command; drives the FAILED badge.
  isError?: boolean;
  // Script run this row executed when its sandbox modified files; drives the row badge.
  scriptRun?: WireScriptRun;
  isGitBaseline?: undefined;
  text?: undefined;
  isSystem?: undefined;
  snapshots?: undefined;
  gitOperations?: undefined;
  stepNumber?: undefined;
  fileChanges?: undefined;
  detail?: undefined;
  resultHash?: undefined;
};

export type TimelineNode = TurnNode | SessionEndNode | CommitNode | ToolCallNode | LineNode;
