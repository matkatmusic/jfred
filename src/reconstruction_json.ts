// JSON builders for --json output. MUST NOT import from reconstruction_cli.ts.

import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SkippedLine } from "./parse/loadTranscript.ts";
import { RecordType, BlockType, FailureScope } from "./structures/vocabulary.ts";
import {
    drainReconstructionFailures,
    noteReconstructionFailure,
    type ReconstructionFailure,
} from "./reconstruction_health.ts";
import { getContentBlocks, type TextBlock } from "./structures/content-blocks.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { buildLineVerdicts, type LineVerdict } from "./reconstruction_line_verdicts.ts";
import { findConversationBranches } from "./reconstruction_branch.ts";
import { collectOrphanedUuids } from "./reconstruction_orphans.ts";
import { findGitCommitEvents } from "./reconstruction_git_commit_events.ts";
import { findGitOperations, type GitOperation } from "./reconstruction_git_operations.ts";
import { findToolCalls, type ToolCall } from "./reconstruction_tool_calls.ts";
import { summarizeScriptRunFileChanges, type ScriptRunFileChanges } from "./reconstruction_script_runs.ts";
import type { FileHistory, BranchedReconstruction } from "./reconstruction_engine.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { buildStepSnapshots, type StepSnapshot } from "./reconstruction_json_steps.ts";
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

// Extracts displayed text from a record; joins TextBlocks or returns "".
function extractMessageText(record: TranscriptRecord): string {
    const message = record.message as { content?: unknown } | undefined;
    if (message !== undefined && typeof message.content === "string") {
        return message.content;
    }
    const textBlocks = getContentBlocks(record).filter(
        (block): block is TextBlock => block.type === BlockType.text,
    );
    return textBlocks.map((block) => block.text).join("\n");
}

// Build one ConversationMessage from a record (caller has already decided it qualifies).
function buildConversationMessage(record: TranscriptRecord, orphanedUuids: Set<string>): ConversationMessage {
    return {
        uuid: record.uuid,
        parentUuid: record.parentUuid ?? undefined,
        role: record.type as RecordType,
        timestamp: record.timestamp,
        text: extractMessageText(record),
        sessionId: record.sessionId,
        isOrphaned: record.uuid !== undefined && orphanedUuids.has(record.uuid.toString()),
    };
}

// Genuine user prompts and assistant replies with visible text.
export function extractConversationMessages(records: TranscriptRecord[]): ConversationMessage[] {
    const orphanedUuids = collectOrphanedUuids(records);
    const messages: ConversationMessage[] = [];
    for (const record of records) {
        if (isGenuineUserPrompt(record)) {
            messages.push(buildConversationMessage(record, orphanedUuids));
            continue;
        }
        if (record.type === RecordType.assistant && extractMessageText(record) !== "") {
            messages.push(buildConversationMessage(record, orphanedUuids));
        }
    }
    return messages;
}

export type BranchSummary = {
    tip: Uuid;
    rewindPoint: Uuid | undefined;
    isSurviving: boolean;
    wasRewound: boolean;
};

export function summarizeBranches(records: TranscriptRecord[]): BranchSummary[] {
    return findConversationBranches(records).map((branch) => ({
        tip: branch.tip,
        rewindPoint: branch.rewindPoint,
        isSurviving: branch.isSurviving,
        wasRewound: !branch.isSurviving,
    }));
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
        if (record.type !== RecordType.customTitle) continue;
        if (record.sessionId === undefined) continue;
        const title = record["customTitle"];
        if (typeof title !== "string") continue;
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

// Degrades a throwing sub-phase to its fallback so partial results still ship.
function buildPhaseTolerantly<T>(phase: string, fallback: T, run: () => T): T {
    try {
        return run();
    } catch (error) {
        noteReconstructionFailure({ scope: FailureScope.documentPhase, stage: phase, reason: String(error) });
        return fallback;
    }
}

export function buildReconstructionDocument(
    records: TranscriptRecord[],
    branched: BranchedReconstruction,
    reader: BackupReader | undefined,
    target: Path | undefined,
    skippedLines: SkippedLine[] = [],
): BuiltReconstruction {
    const filesTouched =
        target === undefined
            ? branched.surviving
            : branched.surviving.filter((history) => history.target.equals(target));
    // Abandoned-branch histories, unwrapped from branch tags; filtered like filesTouched.
    const rewoundHistories = branched.rewound.flatMap((branch) => branch.histories);
    const rewoundFilesTouched =
        target === undefined
            ? rewoundHistories
            : rewoundHistories.filter((history) => history.target.equals(target));
    // task 119: each sub-phase uses buildPhaseTolerantly to degrade gracefully.
    reportReconstructionProgress("extracting conversation messages");
    // task 119: const messages = extractConversationMessages(records);
    const messages = buildPhaseTolerantly("extractConversationMessages", [], () => extractConversationMessages(records));
    reportReconstructionProgress("summarizing branches");
    // task 119: const branches = summarizeBranches(records);
    const branches = buildPhaseTolerantly("summarizeBranches", [], () => summarizeBranches(records));
    reportReconstructionProgress("building step snapshots");
    // task 119: const { steps, stepFileHistories } = buildStepSnapshots(records, reader, branched.surviving);
    const { steps: allSteps, stepFileHistories } = buildPhaseTolerantly(
        "buildStepSnapshots",
        { steps: [], stepFileHistories: [] },
        () => buildStepSnapshots(records, reader, branched.surviving),
    );
    // task 181: --target narrows step timeline to only steps touching the target.
    const steps =
        target === undefined
            ? allSteps
            : allSteps.filter((step) => step.changedPaths.includes(target.toString()));
    reportReconstructionProgress("building line verdicts");
    // task 119: const lineVerdicts = buildLineVerdicts(records);
    const lineVerdicts = buildPhaseTolerantly("buildLineVerdicts", [], () => buildLineVerdicts(records));
    // task 119: const commitMarkers = findGitCommitEvents(records).map(...);
    const commitMarkers = buildPhaseTolerantly("findGitCommitEvents", [], () => findGitCommitEvents(records).map((event) => ({
        timestamp: event.timestamp,
        sessionId: event.sessionId,
    })));
    // task 119: const gitOperations = findGitOperations(records);
    const gitOperations = buildPhaseTolerantly("findGitOperations", [], () => findGitOperations(records));
    // task 119: const toolCalls = findToolCalls(records);
    const toolCalls = buildPhaseTolerantly("findToolCalls", [], () => findToolCalls(records));
    reportReconstructionProgress("summarizing script-run file changes");
    // task 119: const scriptRuns = summarizeScriptRunFileChanges(records, reader);
    const scriptRuns = buildPhaseTolerantly("summarizeScriptRunFileChanges", [], () => summarizeScriptRunFileChanges(records, reader));
    const document: ReconstructionDocument = {
        sessionId: findSessionId(records),
        sessionTitles: findSessionTitles(records),
        messages,
        branches,
        filesTouched,
        rewoundFilesTouched,
        steps,
        lineVerdicts,
        commitMarkers,
        gitOperations,
        toolCalls,
        scriptRuns,
        skippedLines,
        // Drained LAST so stage/file notes accumulated during reconstructBranches (earlier in the build) ride along with the phase notes above.
        failures: drainReconstructionFailures(),
    };
    return { document, stepFileHistories };
}

