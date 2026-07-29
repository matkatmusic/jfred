// Row labels, pills, tags, and raw-line ownership for the revision timeline (split from timeline.ts, task 92).

import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type FileChange,
    type TimelineNode,
} from "./timeline-types.ts";

// Capped so the row's [{ }] button, timestamp, and L:n label stay visible (item 55).
const TOOL_CALL_SUMMARY_MAX_CHARS = 50;
export function truncateToolCallSummary(summary: string): string {
    const firstLine = summary.split("\n")[0]!;
    if (firstLine.length <= TOOL_CALL_SUMMARY_MAX_CHARS) {
        return firstLine;
    }
    return `${firstLine.slice(0, TOOL_CALL_SUMMARY_MAX_CHARS)}…`;
}

// Matches by changeId or the turn's own record uuid, so stepping onto a reply's line selects it (item 55).
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

// The ls row and its rtk-rewrite row share a toolUseId, so each row must resolve by record first.
function checkToolCallOwnsRawLineByRecord(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== TOOL_CALL_NODE_KIND) {
        return false;
    }
    return rawLineText.includes(`"uuid":"${node.uuid}"`);
}

// Hook attachments and tool_result records carry the toolu id, mapping back to the call (item 55).
function checkToolCallOwnsRawLineByToolUseId(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== TOOL_CALL_NODE_KIND) {
        return false;
    }
    return rawLineText.includes(node.toolUseId!);
}

// Must match the record's own uuid field; a substring match wrongly hits prompt references (s39 bug, item 55).
function checkUserTurnOwnsRawLine(node: TimelineNode, rawLineText: string): boolean {
    if (node.kind !== USER_TURN_NODE_KIND) {
        return false;
    }
    return rawLineText.includes(`"uuid":"${node.uuid!}"`);
}

// Tier order matters: a line carrying both a changeId and a prompt uuid is about the file change.
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

// The inline tag naming what an unattributed-lane step is (item 10d).
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

// A hunk-less block (a rename block is just its header) needs prose, or the pane looks empty (item 47).
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

// An agent turn with no reply text is tool activity, not a reply (item 52).
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

// Single home for session shortening so uuid column, sidebar, and session-end rows agree (item 66).
export function computeSessionShortLabel(sessionId: string): string {
    return sessionId.slice(0, 8);
}

// Summary lines carry no date field, so a blank cell beats "Invalid Date" (task 160).
export function formatRowTimestamp(when: string): string {
    const stamp = new Date(when);
    if (Number.isNaN(stamp.getTime())) {
        return "";
    }
    return stamp.toLocaleString();
}

// Wire event kind of a script-made revision (mirrors EventKind.scriptExecution).
export const SCRIPT_EXECUTION_EVENT_KIND = "script-execution";

// Shared by the role-pill path and the merged base-commit row's dress (task 121).
export const GIT_BASELINE_ROLE_PILL_LABEL = "git-derived baseline";

// sessionTitles is optional because older cached documents predate the field.
export function computeSessionStartLabel(sessionTitles: Record<string, string> | undefined, sessionId: string): string {
    const title = sessionTitles === undefined ? undefined : sessionTitles[sessionId];
    if (title === undefined) return `Session started: ${sessionId}`;
    return `Session ${title} started: ${sessionId}`;
}

// Marker rows go before these indexes, so an interleaved multi-JSONL project shows where each session began.
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

// Commit and session-end rows get no pill because their text already names them (task 86).
export function computeRolePillLabel(node: TimelineNode): string | undefined {
    if (node.kind === USER_TURN_NODE_KIND) return "User";
    if (node.kind === TOOL_CALL_NODE_KIND) return "Tool";
    if (node.kind !== AGENT_TURN_NODE_KIND) return undefined;
    if (node.isGitBaseline === true) return GIT_BASELINE_ROLE_PILL_LABEL;
    const ranScript = (node.fileChanges ?? []).some((change) => change.eventKind === SCRIPT_EXECUTION_EVENT_KIND);
    if (ranScript) return "Script";
    return "Agent";
}

// Multi-word labels hyphenate so the CSS class stays a single token.
export function computeRolePillClass(label: string): string {
    return `role-pill-${label.toLowerCase().replaceAll(" ", "-")}`;
}

// A row's collapsed one-line text, per node kind (item 66).
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
