// Row labels, pills, tags, and raw-line ownership for the revision timeline (split from
// timeline.ts, task 92): everything that turns a TimelineNode into its display strings, plus the
// raw-JSONL-line → node resolution tiers.

import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type FileChange,
    type TimelineNode,
} from "./timeline-types.ts";

// A tool row's display text: first line only, capped at 50 chars, so the row's [{ }] button,
// timestamp, and L:n label always stay visible (item 55, user-specified cap).
const TOOL_CALL_SUMMARY_MAX_CHARS = 50;
export function truncateToolCallSummary(summary: string): string {
    const firstLine = summary.split("\n")[0]!;
    if (firstLine.length <= TOOL_CALL_SUMMARY_MAX_CHARS) {
        return firstLine;
    }
    return `${firstLine.slice(0, TOOL_CALL_SUMMARY_MAX_CHARS)}…`;
}

// True when an agent turn owns the raw line: one of its snapshots' changeIds appears verbatim in
// the line text (the inverse of findLineForChangeId's substring convention), or the line IS the
// turn's own message record (its "uuid":"…" field, item 55 — so stepping onto a reply's record
// line selects the reply's step).
function checkAgentTurnOwnsRawLine(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== AGENT_TURN_NODE_KIND) {
        return false;
    }
    if (node.uuid !== undefined) {
        if (rawLineText.includes(`"uuid":"${node.uuid}"`)) {
            return true;
        }
    }
    return node.snapshots.some((snapshot) =>
        snapshot.changeIds.some((changeId) => rawLineText.includes(changeId)));
}

// True when a tool-call row's own record IS the raw line (its "uuid":"…" field) — the ls row and
// its rtk-rewrite row share a toolUseId, so each row's own line must resolve by record first.
function checkToolCallOwnsRawLineByRecord(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== TOOL_CALL_NODE_KIND) {
        return false;
    }
    return rawLineText.includes(`"uuid":"${node.uuid}"`);
}

// True when the raw line references a tool-call row's toolUseId verbatim — hook attachments and
// tool_result records carry the toolu id, mapping those lines back to the call that ran (item 55).
function checkToolCallOwnsRawLineByToolUseId(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== TOOL_CALL_NODE_KIND) {
        return false;
    }
    return rawLineText.includes(node.toolUseId!);
}

// True when a user turn owns the raw line: the line IS its message record — the uuid must appear
// as the record's own "uuid":"…" field. A bare-substring match would fire on lines that merely
// REFERENCE the prompt (a file-history-snapshot's inner snapshot.messageId, a parentUuid) and
// wrongly re-select an earlier step (the s39 lines-49/50 → Step 3 bug, item 55).
function checkUserTurnOwnsRawLine(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== USER_TURN_NODE_KIND) {
        return false;
    }
    return rawLineText.includes(`"uuid":"${node.uuid!}"`);
}

// The index of the timeline node owning the raw JSONL line; -1 when no node matches (e.g. a
// summary line, or a snapshot line whose changeIds resolve to no node). Tiers, most specific
// first: (1) agent turns by changeId / own record line — a file-history-snapshot line embeds BOTH
// a changeId and the uuid of the prompt that triggered it, and such a line is about the file
// change, not the prompt; (2) tool-call rows by their own record line; (3) tool-call rows by
// toolUseId (hook attachments, tool_results); (4) user turns by their own record line.
export function findTimelineNodeIndexForRawLine(nodes: TimelineNode[], rawLineText: string): number {
    const agentTurnIndex = nodes.findIndex((node) => checkAgentTurnOwnsRawLine(node, rawLineText));
    if (agentTurnIndex >= 0) {
        return agentTurnIndex;
    }
    const toolCallRecordIndex = nodes.findIndex((node) => checkToolCallOwnsRawLineByRecord(node, rawLineText));
    if (toolCallRecordIndex >= 0) {
        return toolCallRecordIndex;
    }
    const toolCallReferenceIndex = nodes.findIndex((node) => checkToolCallOwnsRawLineByToolUseId(node, rawLineText));
    if (toolCallReferenceIndex >= 0) {
        return toolCallReferenceIndex;
    }
    return nodes.findIndex((node) => checkUserTurnOwnsRawLine(node, rawLineText));
}

// The inline tag naming what an unattributed-lane step is (item 10d): its chips' event
// kinds, deduped in first-appearance order, humanized ("script-execution" → "script run",
// otherwise hyphens → spaces), joined with " · "; undefined when the step has no chips.
export function computeUnattributedStepTag(eventKinds: string[]): string | undefined {
    const humanizedKinds = [...new Set(eventKinds)].map((kind) => {
        if (kind === "script-execution") {
            return "script run";
        }
        return kind.replaceAll("-", " ");
    });
    if (humanizedKinds.length === 0) {
        return undefined;
    }
    return humanizedKinds.join(" · ");
}

// A diff block with no hunk lines (a rename block is just its kind header) renders as an
// explanation instead of an empty-looking pane (item 47); multi-line blocks return undefined
// (render as a diff).
export function computeRevisionDiffFallbackText(block: string | undefined, change: FileChange): string | undefined {
    if (block === undefined) {
        return "(no diff block for this revision)";
    }
    if (block.trim().split("\n").length > 1) {
        return undefined;
    }
    if (change.renamedFrom !== undefined) {
        return `renamed ${change.renamedFrom} → ${change.path} (content unchanged)`;
    }
    return `${block.trim()}\n(no content change in this revision)`;
}

// An agent turn with no reply text is tool activity, not a reply (item 52): file chips mean
// the step shows tool RESULTS. Replies (non-blank text) and chip-less turns return undefined.
// (item 55) the "tool call" branch is retired — git rows moved out of turn bubbles into
// standalone tool-call nodes, so a blank turn whose only content is gitOperations no longer
// exists; the parameter stays for wire-shape compatibility.
export function computeToolActivityTag(node: {
    kind: string;
    text: string;
    fileChanges?: FileChange[];
    gitOperations?: readonly unknown[];
}): string | undefined {
    if (node.kind !== AGENT_TURN_NODE_KIND) {
        return undefined;
    }
    if (node.text.trim() !== "") {
        return undefined;
    }
    if ((node.fileChanges ?? []).length > 0) {
        return "tool result";
    }
    // (item 55) old: if ((node.gitOperations ?? []).length > 0) { return "tool call"; }
    return undefined;
}

// A session id's 8-char short label — the fork layout's uuid column, sidebar entries, and
// session-end rows all shorten sessions the same way (item 66).
export function computeSessionShortLabel(sessionId: string): string {
    return sessionId.slice(0, 8);
}

// Wire event kind of a script-made revision (mirrors EventKind.scriptExecution).
export const SCRIPT_EXECUTION_EVENT_KIND = "script-execution";

// The green baseline pill's label — shared by the role-pill path (standalone baseline turn)
// and the merged base-commit row's dress (task 121).
export const GIT_BASELINE_ROLE_PILL_LABEL = "git-derived baseline";

// The session-start marker's text: the session's user-given custom title when the document
// carries one ("Session <title> started: <id>"), else id-only ("Session started: <id>").
// sessionTitles is optional — older cached documents predate the field.
export function computeSessionStartLabel(sessionTitles: Record<string, string> | undefined, sessionId: string): string {
    const title = sessionTitles === undefined ? undefined : sessionTitles[sessionId];
    if (title === undefined) return `Session started: ${sessionId}`;
    return `Session ${title} started: ${sessionId}`;
}

// Where each session's FIRST node sits, in first-appearance order — the timeline inserts a
// session-start marker row before these indexes (item 66 follow-up; an interleaved
// multi-JSONL project otherwise never shows where a later session began). Unattributed
// nodes yield no marker, and interleave switches back to a started session add none.
export function findSessionStartIndexes(nodes: TimelineNode[]): { nodeIndex: number; sessionId: string }[] {
    const starts: { nodeIndex: number; sessionId: string }[] = [];
    const seenSessionIds = new Set<string>();
    for (const [nodeIndex, node] of nodes.entries()) {
        if (node.sessionId === undefined) continue;
        if (seenSessionIds.has(node.sessionId)) continue;
        seenSessionIds.add(node.sessionId);
        starts.push({ nodeIndex, sessionId: node.sessionId });
    }
    return starts;
}

// The pill-style role tag opening a row — "User" / "Agent" / "Tool" / "Script" /
// "git-derived baseline" (item 66 follow-up; task 86). An agent turn whose file chips carry a
// script-made revision is the script run's row, so it reads "Script"; the synthetic baseline
// node reads "git-derived baseline"; commit and session-end rows get none (their text names
// them).
export function computeRolePillLabel(node: TimelineNode): string | undefined {
    if (node.kind === USER_TURN_NODE_KIND) return "User";
    if (node.kind === TOOL_CALL_NODE_KIND) return "Tool";
    if (node.kind !== AGENT_TURN_NODE_KIND) return undefined;
    if (node.isGitBaseline === true) return GIT_BASELINE_ROLE_PILL_LABEL;
    const ranScript = (node.fileChanges ?? []).some((change) => change.eventKind === SCRIPT_EXECUTION_EVENT_KIND);
    if (ranScript) return "Script";
    return "Agent";
}

// The pill's per-label CSS class token — multi-word labels ("git-derived baseline") hyphenate so
// the class stays a single token.
export function computeRolePillClass(label: string): string {
    return `role-pill-${label.toLowerCase().replaceAll(" ", "-")}`;
}

// A row's collapsed one-line text, per node kind (item 66): turns show their first text line
// (a blank synthetic agent turn reads "(tool activity)"); tool calls read like the mockup's
// `Bash(npx tsc --noEmit)`; commits show their message; session ends name their session.
export function computeRowSummaryText(node: TimelineNode): string {
    if (node.kind === COMMIT_NODE_KIND) {
        if (node.text !== undefined) {
            return node.text;    // the merged baseline row reads its baseline text (task 121)
        }
        return node.detail ?? "git commit";
    }
    if (node.kind === SESSION_END_NODE_KIND) {
        return `end of session ${computeSessionShortLabel(node.sessionId)}`;
    }
    if (node.kind === TOOL_CALL_NODE_KIND) {
        return `${node.toolName}(${truncateToolCallSummary(node.summary)})`;
    }
    const firstLine = node.text.split("\n")[0]!;
    if (node.kind === AGENT_TURN_NODE_KIND && firstLine.trim() === "") {
        return "(tool activity)";
    }
    return firstLine;
}
