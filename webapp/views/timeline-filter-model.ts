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
