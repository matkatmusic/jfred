// Timeline event-type filter (task 114) — pure model: mode vocabulary + the node predicate.
// DOM-free so tests exercise it directly (same split as timeline-picks.ts / details-model.ts);
// the DOM consumer is timeline-render-filterbar.ts.

import { SCRIPT_EXECUTION_EVENT_KIND } from "./timeline-labels.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type TimelineNode,
} from "./timeline-types.ts";

// View-only vocabulary (not wire vocabulary — stays out of src/structures/vocabulary.ts;
// frozen-const pattern per SplitRowKind in diff-vs-base-model.ts).
export const TIMELINE_FILTER_MODES = Object.freeze({
    all: "all",
    conversation: "conversation",
    tools: "tools",
    scripts: "scripts",
    files: "files",
    git: "git",
} as const);
export type TimelineFilterMode = (typeof TIMELINE_FILTER_MODES)[keyof typeof TIMELINE_FILTER_MODES];

// Ordered [mode, button label] pairs the filter bar renders left-to-right; All leads because
// it is the default.
export const TIMELINE_FILTER_BUTTONS: readonly (readonly [TimelineFilterMode, string])[] = Object.freeze([
    [TIMELINE_FILTER_MODES.all, "All"],
    [TIMELINE_FILTER_MODES.conversation, "Conversation"],
    [TIMELINE_FILTER_MODES.tools, "Tools"],
    [TIMELINE_FILTER_MODES.scripts, "Scripts"],
    [TIMELINE_FILTER_MODES.files, "Files"],
    [TIMELINE_FILTER_MODES.git, "Git"],
]);

// A conversational row is a user or agent turn.
function checkNodeIsConversationTurn(node: TimelineNode): boolean {
    if (node.kind === USER_TURN_NODE_KIND) {
        return true;
    }
    if (node.kind === AGENT_TURN_NODE_KIND) {
        return true;
    }
    return false;
}

// Same script-detection rule as the "Script" role pill (computeRolePillLabel): a tool-call row
// that executed a script, or an agent turn whose file chips carry a script-made revision.
function checkNodeRanScript(node: TimelineNode): boolean {
    if (node.kind === TOOL_CALL_NODE_KIND) {
        if (node.scriptRun !== undefined) {
            return true;
        }
    }
    if (node.kind === AGENT_TURN_NODE_KIND) {
        const fileChanges = node.fileChanges ?? [];
        return fileChanges.some((change) => change.eventKind === SCRIPT_EXECUTION_EVENT_KIND);
    }
    return false;
}

// A file-modifying row carries file-change chips, or is a script run the sandbox proved
// modified files (scriptRun.changedPaths is [] on read-only/declined runs).
function checkNodeModifiesFiles(node: TimelineNode): boolean {
    const fileChanges = node.fileChanges ?? [];
    if (fileChanges.length > 0) {
        return true;
    }
    if (node.kind === TOOL_CALL_NODE_KIND) {
        if (node.scriptRun !== undefined) {
            return node.scriptRun.changedPaths.length > 0;
        }
    }
    return false;
}

// The filter predicate: does `node` stay visible under `mode`? Session-end terminators stay
// visible in every mode — they anchor each session's extent in a filtered timeline.
export function checkNodeMatchesFilterMode(node: TimelineNode, mode: TimelineFilterMode): boolean {
    if (mode === TIMELINE_FILTER_MODES.all) {
        return true;
    }
    if (node.kind === SESSION_END_NODE_KIND) {
        return true;
    }
    if (mode === TIMELINE_FILTER_MODES.conversation) {
        return checkNodeIsConversationTurn(node);
    }
    if (mode === TIMELINE_FILTER_MODES.tools) {
        return node.kind === TOOL_CALL_NODE_KIND;
    }
    if (mode === TIMELINE_FILTER_MODES.scripts) {
        return checkNodeRanScript(node);
    }
    if (mode === TIMELINE_FILTER_MODES.files) {
        return checkNodeModifiesFiles(node);
    }
    return node.kind === COMMIT_NODE_KIND;
}

// ── keyword search (task 127) ────────────────────────────────────────────────────────────────

// Everything a row can visibly say, lowercased once: turn text, tool name/summary, commit
// detail + hash, and each file chip's names (final, entry-time, renamed-from).
function computeNodeSearchHaystack(node: TimelineNode): string {
    const parts: string[] = [];
    if (node.text !== undefined) {
        parts.push(node.text);
    }
    if (node.summary !== undefined) {
        parts.push(node.toolName ?? "", node.summary);
    }
    if (node.detail !== undefined) {
        parts.push(node.detail);
    }
    if (node.resultHash !== undefined) {
        parts.push(node.resultHash);
    }
    for (const change of node.fileChanges ?? []) {
        parts.push(change.path, change.displayPath, change.renamedFrom ?? "");
    }
    return parts.join("\n").toLowerCase();
}

// The search predicate: does `node` stay visible under `term`? Blank matches everything;
// otherwise a case-insensitive substring test over the node's visible text. Deliberately NO
// session-end exemption (unlike the mode predicate): a terminator carries no text, so a real
// term hides it.
export function checkNodeMatchesSearchTerm(node: TimelineNode, term: string): boolean {
    const normalizedTerm = term.trim().toLowerCase();
    if (normalizedTerm === "") {
        return true;
    }
    return computeNodeSearchHaystack(node).includes(normalizedTerm);
}

// A row stays visible iff it passes BOTH the active mode button and the search term.
export function checkNodePassesFilters(node: TimelineNode, mode: TimelineFilterMode, term: string): boolean {
    if (!checkNodeMatchesFilterMode(node, mode)) {
        return false;
    }
    return checkNodeMatchesSearchTerm(node, term);
}

// The search's jump list: the node indexes surviving the combined predicate, in timeline
// order. Entry #1 of the results is the first index; N (the counter denominator) is the
// list's length.
export function computeMatchingNodeIndexes(nodes: TimelineNode[], mode: TimelineFilterMode, term: string): number[] {
    const matchingIndexes: number[] = [];
    for (const [index, node] of nodes.entries()) {
        if (checkNodePassesFilters(node, mode, term)) {
            matchingIndexes.push(index);
        }
    }
    return matchingIndexes;
}
