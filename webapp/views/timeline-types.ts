// Wire-string discriminants mirror src/structures/vocabulary.ts since the webapp can't import TS enums; tests assert equivalence against real members.

import type { LineNode, WireLineVerdict } from "./timeline-line-nodes.ts";
export const COMMIT_NODE_KIND = "commit";
export const USER_TURN_NODE_KIND = "user-turn";
export const AGENT_TURN_NODE_KIND = "agent-turn";
export const SESSION_END_NODE_KIND = "session-end";
export const TOOL_CALL_NODE_KIND = "tool-call";
export const USER_ROLE = "user";
export const EDIT_EVENT_KIND = "edit";
export const COMMIT_OPERATION_KIND = "commit";
// The two EventKind wire strings the Files tree reads: a delete dims the row, a rename badges it.
export const DELETE_EVENT_KIND = "delete";
export const RENAME_EVENT_KIND = "rename";

// Arrives via fetch + JSON.parse, so ids/paths/dates are plain wire strings; these declare only fields this view reads.

export type WireRename = { from: string; to: string };
// Carried on the wire so the file-history view renders each revision from its own lines; no per-step snapshot needed.
export type WireLineEntry = { values: { line: string }[] };
// `unrecoverable` means the engine could not replay this revision: its lines are the previous revision's carried forward.
export type WireRevision = { kind: string; changeId: string; timestamp: string; rename?: WireRename; lines?: WireLineEntry[]; unrecoverable?: { reason: string } };
export type WireFileHistory = { target: string; revisions: WireRevision[] };
// isOrphaned is the engine's branch-membership stamp; optional since older cached documents lack the field (gitOperations convention).
export type WireMessage = { role: string; timestamp: string; sessionId?: string; uuid: string; text: string; isOrphaned?: boolean };
// A skeleton step snapshot (no `files` map, the >512 MB fix); file text is fetched on demand from /api/step-files.
export type WireStepSnapshot = {
    index: number;
    when: string;
    sessionId?: string;
    changeIds: string[];
    changedPaths: string[];
};
export type WireGitOperation = {
    kind: string;
    detail: string;
    command: string;
    timestamp: string;
    sessionId?: string;
    uuid?: string;
    // The commit's short hash from its tool_result text (item 66); absent when non-commit, cached, or hashless.
    resultHash?: string;
    // True when the command's tool_result errored (task 103) — drives the timeline's red FAILED badge.
    isError?: boolean;
};
export type WireCommitMarker = { timestamp: string; sessionId?: string };
// One non-file-edit tool call (item 55): summary is its command/path; uuid resolves the row's label and button; toolUseId joins attachments.
export type WireToolCall = {
    toolName: string;
    summary: string;
    timestamp: string;
    sessionId?: string;
    uuid: string;
    toolUseId: string;
    // Engine-stamped branch membership (optional: older cached documents lack it).
    isOrphaned?: boolean;
};
// Script run and files its sandbox execution changed (task 67); changedPaths is [] when declined; toolUseId joins the tool-call row.
export type WireScriptRun = {
    toolUseId?: string;
    timestamp: string;
    code: string;
    changedPaths: string[];
    // task 143 (optional on older cached docs): proven move pairs; sources collapsed out of changedPaths.
    renamedPaths?: WireRename[];
};
export type WireTimelineDocument = {
    filesTouched: WireFileHistory[];
    rewoundFilesTouched: WireFileHistory[];
    messages: WireMessage[];
    steps: WireStepSnapshot[];
    gitOperations?: WireGitOperation[];
    commitMarkers: WireCommitMarker[];
    // Optional: an older cached document lacks the field (same convention as gitOperations).
    toolCalls?: WireToolCall[];
    // Optional (same convention): the script runs and their sandbox-proven file changes.
    scriptRuns?: WireScriptRun[];
    // Optional (same convention): user-given session names from `custom-title` records.
    sessionTitles?: Record<string, string>;
    // Optional (same convention): lines the tolerant parse skipped (task 119) — dashed gap rows group them by contiguous run.
    skippedLines?: { filePath: string; lineNumber: number; timestamp?: string; reason: string }[];
    // Optional (same convention): every failure the engine survived (task 119) — the partial- reconstruction banner's counts and tooltip reasons.
    failures?: { scope: string; stage: string; target?: string; reason: string }[];
    // Optional (same convention): the user declined pre-baseline reconstruction (task 56) — the git-baseline node becomes the timeline's first shown step.
    preBaselineSkipped?: boolean;
    lineVerdicts?: WireLineVerdict[];
};

// indexRevisionsByChangeId maps a changeId to its revision facts; displayPath is the name at that revision, path stays the fetch key.
export type RevisionIndexEntry = {
    path: string;
    displayPath: string;
    eventKind: string;
    renamedFrom: string | undefined;
    isFirstRevision: boolean;
    isRewound: boolean;
};
export type RevisionIndex = Map<string, RevisionIndexEntry>;

// deriveFileChanges' chips: one file change per path; `when` is the snapshot's instant; displayPath is entry-time only, path is fetch key.
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

// One conversation turn; synthetic trailing agent turns carry no uuid, stepNumber, fileChanges, or isOrphaned since those are stamped after sorting.
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
    // True on the synthetic turn holding the git-derived baseline; the row's role pill reads "git-derived baseline".
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

// One git-commit hard stop (deriveCommitNodes); never numbered, never pickable.
export type CommitNode = {
    kind: typeof COMMIT_NODE_KIND;
    when: string;
    sessionId: string | undefined;
    detail?: string;
    // The commit's short hash (item 66) — the fork layout's `GIT COMMIT [hash]` pill.
    resultHash?: string;
    // True when the commit command's tool_result errored (task 103) — the row's FAILED badge.
    isError?: boolean;
    // task 121: the base-commit row absorbs the git-derived baseline flag, summary, snapshots, and file chips; absent on plain commits.
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

// One un-bubbled tool-call row (item 55); never numbered or pickable, sorts chronologically among the turns it ran between.
export type ToolCallNode = {
    kind: typeof TOOL_CALL_NODE_KIND;
    when: string;
    sessionId: string | undefined;
    uuid: string;
    toolName: string;
    summary: string;
    toolUseId: string;
    // Copied from the engine's per-record wire stamp — a tool row on a rewound branch dims too.
    isOrphaned?: boolean;
    // True when this row's Bash call is a FAILED git command (task 103); joined to gitOperations for the FAILED badge.
    isError?: boolean;
    // Script run this row executed when its sandbox modified files (task 67); drives the row badge and Details pane's mode.
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
