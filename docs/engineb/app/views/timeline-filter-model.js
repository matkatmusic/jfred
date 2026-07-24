// Timeline event-type filter (task 114) — pure model: mode vocabulary + the node predicate.
// DOM-free so tests exercise it directly (same split as timeline-picks.ts / details-model.ts);
// the DOM consumer is timeline-render-filterbar.ts.
import { SCRIPT_EXECUTION_EVENT_KIND, findSessionStartIndexes } from "./timeline-labels.js";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND, } from "./timeline-types.js";
// View-only vocabulary (not wire vocabulary — stays out of src/structures/vocabulary.ts;
// frozen-const pattern per SplitRowKind in diff-vs-base-model.ts).
export const TIMELINE_FILTER_MODES = Object.freeze({
    all: "all",
    conversation: "conversation",
    tools: "tools",
    scripts: "scripts",
    files: "files",
    git: "git",
});
// Ordered [mode, button label] pairs the filter bar renders left-to-right; All leads because
// it is the default.
export const TIMELINE_FILTER_BUTTONS = Object.freeze([
    [TIMELINE_FILTER_MODES.all, "All"],
    [TIMELINE_FILTER_MODES.conversation, "Conversation"],
    [TIMELINE_FILTER_MODES.tools, "Tools"],
    [TIMELINE_FILTER_MODES.scripts, "Scripts"],
    [TIMELINE_FILTER_MODES.files, "Files"],
    [TIMELINE_FILTER_MODES.git, "Git"],
]);
// A conversational row is a user or agent turn.
function checkNodeIsConversationTurn(node) {
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
function checkNodeRanScript(node) {
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
function checkNodeModifiesFiles(node) {
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
export function checkNodeMatchesFilterMode(node, mode) {
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
function computeNodeSearchHaystack(node) {
    const parts = [];
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
// task 148: session titles are searchable. Each titled session contributes ONE extra
// haystack — on its FIRST node — so typing a custom title jumps to the row directly under
// that session's header marker (findSessionStartIndexes inserts the marker before that
// node). Only the first node: every row of a session matching its title would turn the
// search into a session filter, which is not the jump-to-header behavior.
export function computeSessionTitleByNodeIndex(nodes, sessionTitles) {
    const titleByNodeIndex = new Map();
    if (sessionTitles === undefined) {
        return titleByNodeIndex;
    }
    for (const sessionStart of findSessionStartIndexes(nodes)) {
        const sessionTitle = sessionTitles[sessionStart.sessionId];
        if (sessionTitle === undefined) {
            continue;
        }
        titleByNodeIndex.set(sessionStart.nodeIndex, sessionTitle);
    }
    return titleByNodeIndex;
}
// The search predicate: does `node` stay visible under `term`? Blank matches everything;
// otherwise a case-insensitive substring test over the node's visible text — plus the
// node's session title when the caller attached one (task 148). Deliberately NO
// session-end exemption (unlike the mode predicate): a terminator carries no text, so a real
// term hides it.
export function checkNodeMatchesSearchTerm(node, term, sessionTitle) {
    const normalizedTerm = term.trim().toLowerCase();
    if (normalizedTerm === "") {
        return true;
    }
    if (sessionTitle !== undefined && sessionTitle.toLowerCase().includes(normalizedTerm)) {
        return true;
    }
    return computeNodeSearchHaystack(node).includes(normalizedTerm);
}
// A row stays visible iff it passes BOTH the active mode button and the search term.
// sessionTitle (task 148) feeds only the search side — a title never overrides the mode.
export function checkNodePassesFilters(node, mode, term, sessionTitle) {
    if (!checkNodeMatchesFilterMode(node, mode)) {
        return false;
    }
    return checkNodeMatchesSearchTerm(node, term, sessionTitle);
}
// The search's jump list: the node indexes surviving the combined predicate, in timeline
// order. Entry #1 of the results is the first index; N (the counter denominator) is the
// list's length. sessionTitleByNodeIndex (task 148) attaches each titled session's title
// to its first node.
export function computeMatchingNodeIndexes(nodes, mode, term, sessionTitleByNodeIndex) {
    const matchingIndexes = [];
    for (const [index, node] of nodes.entries()) {
        if (checkNodePassesFilters(node, mode, term, sessionTitleByNodeIndex?.get(index))) {
            matchingIndexes.push(index);
        }
    }
    return matchingIndexes;
}
