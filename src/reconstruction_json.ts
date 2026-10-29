// JSON builders for --json output. MUST NOT import from reconstruction_cli.ts.

import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SkippedLine } from "./parse/loadTranscript.ts";
import { RecordType } from "./structures/vocabulary.ts";
import {
  drainReconstructionFailures,
  type ReconstructionFailure,
} from "./reconstruction_health.ts";
import { buildConversationMessage, extractMessageText } from "./reconstruction_json_messages.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import type { LineVerdict } from "./reconstruction_line_verdicts.ts";
import { findConversationBranches } from "./reconstruction_branch.ts";
import { collectOrphanedUuids } from "./reconstruction_orphans.ts";
import type { GitOperation } from "./reconstruction_git_operations.ts";
import type { ToolCall } from "./reconstruction_tool_calls.ts";
import type { ScriptRunFileChanges } from "./reconstruction_script_run_changes.ts";
import type { BranchedReconstruction } from "./reconstruction_engine.ts";
import type { FileHistory } from "./reconstruction_events.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { StepSnapshot } from "./reconstruction_json_steps.ts";
import { buildDocumentSections, buildPhaseTolerantly } from "./reconstruction_json_sections.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

export type ConversationMessage = {
  uuid: Uuid | undefined;
  parentUuid: Uuid | undefined;
  role: RecordType;
  timestamp: Date | undefined;
  text: string;
  sessionId: Uuid | undefined;
  // True when the record sits on a rewound (abandoned) branch.
  isOrphaned: boolean;
};

// Genuine user prompts and assistant replies with visible text.
export function extractConversationMessages(records: TranscriptRecord[]): ConversationMessage[] {
  const orphanedUuids = collectOrphanedUuids(records);
  const messages: ConversationMessage[] = [];
  for (const record of records) {
    const isUserPrompt = isGenuineUserPrompt(record);
    if (isUserPrompt) {
      messages.push(buildConversationMessage(record, orphanedUuids));
      continue;
    }
    if (record.type !== RecordType.assistant)
      continue;
    const messageText = extractMessageText(record);
    if (messageText !== "")
      messages.push(buildConversationMessage(record, orphanedUuids));
  }
  return messages;
}

export type BranchSummary = {
  tip: Uuid;
  rewindPoint: Uuid | undefined;
  isSurviving: boolean;
  wasRewound: boolean;
};

export function collectBranchSummaries(records: TranscriptRecord[]): BranchSummary[] {
  const summaries: BranchSummary[] = [];
  for (const branch of findConversationBranches(records)) {
    summaries.push({ tip: branch.tip, rewindPoint: branch.rewindPoint, isSurviving: branch.isSurviving, wasRewound: !branch.isSurviving });
  }
  return summaries;
}

// Transcript-detected git commits; markers (not changeIds) are the viewer's commit signal.
export type CommitMarker = {
  timestamp: Date;
  sessionId: Uuid | undefined;
};

// User-given session names keyed by session id, from custom-title records.
export function findSessionTitles(records: TranscriptRecord[]): Record<string, string> {
  const titlesBySessionId: Record<string, string> = {};
  for (const record of records) {
    const title = record["customTitle"];
    const isSessionTitle = record.type === RecordType.customTitle && record.sessionId !== undefined && typeof title === "string";
    if (isSessionTitle)
      titlesBySessionId[String(record.sessionId)] = title;
  }
  return titlesBySessionId;
}

export type ReconstructionDocument = {
  sessionId: Uuid | undefined;
  sessionTitles: Record<string, string>;
  messages: ConversationMessage[];
  branches: BranchSummary[];
  filesTouched: FileHistory[];
  rewoundFilesTouched: FileHistory[];
  steps: StepSnapshot[];
  lineVerdicts: LineVerdict[];
  commitMarkers: CommitMarker[];
  gitOperations: GitOperation[];
  toolCalls: ToolCall[];
  scriptRuns: ScriptRunFileChanges[];
  // Every line the tolerant parse skipped — the webapp's timeline gap rows.
  skippedLines: SkippedLine[];
  // task 56: true when user declined pre-baseline reconstruction (viewer-stamped).
  preBaselineSkipped?: boolean;
  // Failures the engine survived while building this document.
  failures: ReconstructionFailure[];
};

// Document and step-file histories kept separate to avoid the >512 MB RangeError.
export type BuiltReconstruction = { document: ReconstructionDocument; stepFileHistories: FileHistory[] };

export function buildReconstructionDocument(
  records: TranscriptRecord[],
  branched: BranchedReconstruction,
  reader: BackupReader | undefined,
  target: Path | undefined,
  skippedLines: SkippedLine[] = [],
): BuiltReconstruction {
  // task 119: each sub-phase uses buildPhaseTolerantly to degrade gracefully.
  reportReconstructionProgress("extracting conversation messages");
  // task 119: const messages = extractConversationMessages(records);
  const messages = buildPhaseTolerantly("extractConversationMessages", [], extractConversationMessages.bind(undefined, records));
  reportReconstructionProgress("summarizing branches");
  // task 119: const branches = collectBranchSummaries(records);
  const branches = buildPhaseTolerantly("summarizeBranches", [], collectBranchSummaries.bind(undefined, records));
  const sections = buildDocumentSections(records, branched, reader, target);
  const document: ReconstructionDocument = {
    sessionId: findSessionId(records),
    sessionTitles: findSessionTitles(records),
    messages,
    branches,
    filesTouched: sections.filesTouched,
    rewoundFilesTouched: sections.rewoundFilesTouched,
    steps: sections.steps,
    lineVerdicts: sections.lineVerdicts,
    commitMarkers: sections.commitMarkers,
    gitOperations: sections.gitOperations,
    toolCalls: sections.toolCalls,
    scriptRuns: sections.scriptRuns,
    skippedLines,
    // Drained LAST so stage/file notes accumulated during reconstructBranches (earlier in the build) ride along with the phase notes above.
    failures: drainReconstructionFailures(),
  };
  return { document, stepFileHistories: sections.stepFileHistories };
}

