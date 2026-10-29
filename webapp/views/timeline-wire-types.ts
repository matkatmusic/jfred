import type { WireLineVerdict } from "./timeline-line-nodes.ts";

// Arrives via fetch and JSON.parse, so ids, paths, and dates are plain wire strings.

export type WireRename = { from: string; to: string };
// Carried on the wire so the file-history view renders each revision from its own lines.
export type WireLineEntry = { values: { line: string }[] };
// `unrecoverable` means the engine could not replay this revision: its lines carry forward.
export type WireRevision = { kind: string; changeId: string; timestamp: string; rename?: WireRename; lines?: WireLineEntry[]; unrecoverable?: { reason: string } };
export type WireFileHistory = { target: string; revisions: WireRevision[] };
// isOrphaned is the engine's branch-membership stamp; older cached documents lack it.
export type WireMessage = { role: string; timestamp: string; sessionId?: string; uuid: string; text: string; isOrphaned?: boolean };
// A skeleton step snapshot with no `files` map; file text is fetched from /api/step-files.
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
  // The commit's short hash from its tool_result text; absent when non-commit, cached, or hashless.
  resultHash?: string;
  // True when the command's tool_result errored; drives the timeline's red FAILED badge.
  isError?: boolean;
};
export type WireCommitMarker = { timestamp: string; sessionId?: string };
// One non-file-edit tool call: summary is its command or path; toolUseId joins attachments.
export type WireToolCall = {
  toolName: string;
  summary: string;
  timestamp: string;
  sessionId?: string;
  uuid: string;
  toolUseId: string;
  // Engine-stamped branch membership; older cached documents lack it.
  isOrphaned?: boolean;
};
// A script run and the files its sandbox changed; changedPaths is empty when declined.
export type WireScriptRun = {
  toolUseId?: string;
  timestamp: string;
  code: string;
  changedPaths: string[];
  // Proven move pairs, absent on older cached documents; sources collapse out of changedPaths.
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
  // Optional (same convention): lines the tolerant parse skipped; dashed gap rows group them.
  skippedLines?: { filePath: string; lineNumber: number; timestamp?: string; reason: string }[];
  // Optional (same convention): every failure the engine survived; feeds the partial-reconstruction banner.
  failures?: { scope: string; stage: string; target?: string; reason: string }[];
  // Optional (same convention): the user declined pre-baseline reconstruction.
  preBaselineSkipped?: boolean;
  lineVerdicts?: WireLineVerdict[];
};
