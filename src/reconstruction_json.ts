// Pure JSON builders: turn the engine's reconstruction objects into plain serializable shapes for the
// CLI's --json output (parallels reconstruction_render.ts for the text views). MUST NOT import from
// reconstruction_cli.ts — one-way dependency, no cycle. The renderJson dispatch lives in the CLI.

import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SkippedLine } from "./parse/loadTranscript.ts";
import { RecordType, BlockType, Verdict, FailureScope } from "./structures/vocabulary.ts";
import {
    drainReconstructionFailures,
    noteReconstructionFailure,
    type ReconstructionFailure,
} from "./reconstruction_health.ts";
import { getContentBlocks, type TextBlock } from "./structures/content-blocks.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { recordVerdict } from "./reconstruction_parse_lines.ts";
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
    // True when the record sits on a rewound (abandoned) conversation branch — the timeline dims
    // the whole exchange, user prompts included (collectOrphanedUuids).
    isOrphaned: boolean;
};

// The displayed text of a user prompt or assistant reply: a plain-string content is the text itself;
// an array content is its TextBlocks joined. "" when the record carries no text.
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

// The conversation as the user sees it: genuine typed-in user prompts (engine's isGenuineUserPrompt,
// which rejects tool-result / isMeta / `/exit` user records) plus assistant replies that have displayed
// text (pure tool_use turns carry no text and are skipped).
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

export type LineVerdict = {
    line: number;
    uuid: Uuid | undefined;
    type: RecordType;
    verdict: Verdict;
    isGenuinePrompt: boolean;
};

// The engine's per-line classification, line-aligned to the parsed records array. Pure surfacing of
// recordVerdict + isGenuineUserPrompt (both per-record, no transcript context) — no new logic.
export function buildLineVerdicts(records: TranscriptRecord[]): LineVerdict[] {
    return records.map((record, index) => ({
        line: index,
        uuid: record.uuid,
        type: record.type,
        verdict: recordVerdict(record),
        isGenuinePrompt: isGenuineUserPrompt(record),
    }));
}

// When a `git commit` ran and which session ran it — detected purely from the transcript
// (findGitCommitEvents; no exec gate, no on-disk repo). Commit markers are the timeline's pick
// hard-stops. NOTE: evidence-spliced commit revisions carry RANDOM changeIds that match no JSONL
// line — markers, not changeIds, are the only commit signal usable by the viewer.
export type CommitMarker = {
    timestamp: Date;
    sessionId: Uuid | undefined;
};

// Every session's user-given name, keyed by session id — from the `custom-title` records
// users create when naming sessions ({type:"custom-title", customTitle, sessionId}). The
// timeline's session-start markers read "Session <title> started: <id>" from this; sessions
// never named simply have no entry. Plain string-keyed Record on the wire (the StepSnapshot
// `files` precedent).
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
    // task 56: true only when the user declined pre-baseline reconstruction (viewer-stamped,
    // never by the CLI) — the timeline starts at the git-baseline node.
    preBaselineSkipped?: boolean;
    // Every failure the engine survived while building THIS document. Known limitation: per-file
    // revision memos are cached per records-array, so a warm rebuild over cached revisions
    // re-reports only per-revision `unrecoverable` flags (cached inside the revision objects),
    // not stage notes; the viewer also caches the whole document per stamp, so in practice the
    // first (real) build's failures are what users see.
    failures: ReconstructionFailure[];
};

// The wire document AND the compact step-file histories, returned as SEPARATE values: the histories are
// never a document field, so JSON.stringify(document) stays small (the >512 MB RangeError fix). A server
// caches both; the histories resolve any one step's file text on demand (resolveFilesAtStep).
export type BuiltReconstruction = { document: ReconstructionDocument; stepFileHistories: FileHistory[] };

// Run one document sub-phase, degrading to a fallback value when it throws so every file
// state already computed still ships.
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
    // Rewound (abandoned-branch) histories, unwrapped from their branch tags — the timeline marks
    // steps orphaned when their changeIds resolve only here. Filtered like filesTouched.
    const rewoundHistories = branched.rewound.flatMap((branch) => branch.histories);
    const rewoundFilesTouched =
        target === undefined
            ? rewoundHistories
            : rewoundHistories.filter((history) => history.target.equals(target));
    // Sequenced (not an inline object literal) so each sub-phase announces before it runs and the
    // console's line timestamps attribute the build time to the right phase.
    // task 119: each sub-phase runs through buildPhaseTolerantly — a throwing phase degrades to
    // its empty fallback instead of killing the whole document.
    reportReconstructionProgress("extracting conversation messages");
    // task 119: const messages = extractConversationMessages(records);
    const messages = buildPhaseTolerantly("extractConversationMessages", [], () => extractConversationMessages(records));
    reportReconstructionProgress("summarizing branches");
    // task 119: const branches = summarizeBranches(records);
    const branches = buildPhaseTolerantly("summarizeBranches", [], () => summarizeBranches(records));
    reportReconstructionProgress("building step snapshots");
    // task 119: const { steps, stepFileHistories } = buildStepSnapshots(records, reader, branched.surviving);
    const { steps, stepFileHistories } = buildPhaseTolerantly(
        "buildStepSnapshots",
        { steps: [], stepFileHistories: [] },
        () => buildStepSnapshots(records, reader, branched.surviving),
    );
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
        // Drained LAST so stage/file notes accumulated during reconstructBranches (earlier in the
        // build) ride along with the phase notes above.
        failures: drainReconstructionFailures(),
    };
    return { document, stepFileHistories };
}

