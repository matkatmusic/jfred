// Timeline node assembly (split from timeline.ts, task 92): turning the wire document's
// messages, step snapshots, git operations, and tool calls into the sorted, numbered
// TimelineNode list (buildTurnTimelineViewModel).

import { recordGitBaselineSnapshot } from "./timeline-baseline-host.ts";
import {
    checkSnapshotIsGitBaseline,
    deriveNodeFileChanges,
    indexRevisionsByChangeId,
} from "./timeline-changes.ts";
import { LINE_NODE_KIND, deriveLineNodes } from "./timeline-line-nodes.ts";
import { deriveCommitNodes, deriveToolCallNodes } from "./timeline-node-derive.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_ROLE,
    USER_TURN_NODE_KIND,
    type CommitNode,
    type SessionEndNode,
    type SnapshotInstant,
    type TimelineNode,
    type ToolCallNode,
    type TurnNode,
    type WireStepSnapshot,
    type WireTimelineDocument,
} from "./timeline-types.ts";

// Tie-break rank for nodes sharing a timestamp: turns first (a commit records the state the turn
// built up), then tool rows (they ran after the reply they follow, item 55), then commits, then
// session ends (they close the session after everything in it).
function computeNodeKindRank(kind: TimelineNode["kind"]): number {
    if (kind === SESSION_END_NODE_KIND) {
        return 3;
    }
    if (kind === COMMIT_NODE_KIND) {
        return 2;
    }
    if (kind === TOOL_CALL_NODE_KIND) {
        return 1;
    }
    return 0;
}

// Chronological; ties resolved by kind rank, insertion order otherwise (sort is stable).
function compareTimelineNodes(a: TimelineNode, b: TimelineNode): number {
    if (a.when < b.when) {
        return -1;
    }
    if (a.when > b.when) {
        return 1;
    }
    return computeNodeKindRank(a.kind) - computeNodeKindRank(b.kind);
}

// True when this agent-turn node is the snapshot's owner candidate: same session, at or after the
// snapshot (tool calls execute before the assistant's reply text is emitted).
function checkNodeCanOwnSnapshot(node: TurnNode, snapshot: SnapshotInstant): boolean {
    if (node.kind !== AGENT_TURN_NODE_KIND) {
        return false;
    }
    if (node.sessionId !== snapshot.sessionId) {
        return false;
    }
    return node.when >= snapshot.when;
}

// Per snapshot: the FIRST agent-turn node of its own session at or after it (turnNodes are in
// message order, chronological per session). Ownerless snapshots are always a trailing suffix of
// their session (steps are chronological), so they collect into ONE synthetic empty-text agent
// turn per session — no file change is ever silently dropped. gitBase-only steps split off
// FIRST into the baseline host (task 86; since task 121 the recorded base-commit row when one
// exists, a dedicated baseline turn otherwise).
function attachSnapshotsToAgentTurns(turnNodes: TurnNode[], commitNodes: CommitNode[], steps: WireStepSnapshot[]): void {
    const syntheticTurns = new Map<string | undefined, TurnNode>();
    let baselineHost: TurnNode | CommitNode | undefined;
    for (const snapshot of steps) {
        // (task 86) gitBase-only steps get their own baseline node — they must not mingle with
        // the generic unattributed synthetic turn below.
        if (checkSnapshotIsGitBaseline(snapshot)) {
            baselineHost = recordGitBaselineSnapshot(turnNodes, commitNodes, snapshot, baselineHost);
            continue;
        }
        const owner = turnNodes.find((node) => checkNodeCanOwnSnapshot(node, snapshot));
        if (owner !== undefined) {
            owner.snapshots.push(snapshot);
            continue;
        }
        const synthetic = syntheticTurns.get(snapshot.sessionId);
        if (synthetic !== undefined) {
            synthetic.snapshots.push(snapshot);
            synthetic.when = snapshot.when;
            continue;
        }
        const trailingTurn: TurnNode = {
            kind: AGENT_TURN_NODE_KIND,
            when: snapshot.when,
            sessionId: snapshot.sessionId,
            text: "",
            snapshots: [snapshot],
            gitOperations: [],
        };
        syntheticTurns.set(snapshot.sessionId, trailingTurn);
        turnNodes.push(trailingTurn);
    }
}

// (item 66) the item-55 dead git-row machinery (attachGitOperationsToAgentTurns,
// findLastAgentTurnOfSession, formatGitOperationLabel, renderGitOperationRow,
// showGitOperationJson) is deleted here per the plan — it lives on in
// webapp/archive/timeline-pre-item66.ts.

// One session-end node per distinct session (insertion order), timestamped at the session's last
// turn OR tool call — the end node closes the session after everything in it (a trailing `git
// add` row must precede its session end, item 55); compareTimelineNodes ranks it after everything
// else sharing that timestamp. Unattributed turns (no sessionId — e.g. script executions) are not
// a session and get no end node.
function appendSessionEndNodes(turnNodes: (TurnNode | SessionEndNode)[], toolCallNodes: ToolCallNode[]): void {
    const lastTurnTimes = new Map<string, string>();
    const noteSessionInstant = (sessionId: string | undefined, when: string): void => {
        if (sessionId === undefined) {
            return;
        }
        const latest = lastTurnTimes.get(sessionId);
        if (latest === undefined) {
            lastTurnTimes.set(sessionId, when);
            return;
        }
        if (when > latest) {
            lastTurnTimes.set(sessionId, when);
        }
    };
    for (const node of turnNodes) {
        noteSessionInstant(node.sessionId, node.when);
    }
    for (const node of toolCallNodes) {
        noteSessionInstant(node.sessionId, node.when);
    }
    for (const [sessionId, when] of lastTurnTimes) {
        turnNodes.push({ kind: SESSION_END_NODE_KIND, when, sessionId, snapshots: [] });
    }
}

// Walk the sorted nodes: user turns, agent turns, and session ends get stepNumber 1..N
// continuously across sessions; commit nodes and tool-call rows stay unnumbered.
function assignStepNumbers(nodes: TimelineNode[]): void {
    let stepNumber = 0;
    for (const node of nodes) {
        if (node.kind === COMMIT_NODE_KIND) {
            continue;
        }
        if (node.kind === TOOL_CALL_NODE_KIND) {
            continue;
        }
        // task 134: raw-line rows must not renumber steps — numbers drive picks and range patches.
        if (node.kind === LINE_NODE_KIND) {
            continue;
        }
        stepNumber += 1;
        node.stepNumber = stepNumber;
    }
}

// True when the message text is harness-generated rather than typed/authored: slash-command
// envelopes (<command-message>, <command-name>, <local-command-stdout>) and injected
// <system-reminder> blocks. These render dimmer than genuine user prompts and agent replies.
function checkMessageTextIsSystem(text: string): boolean {
    if (text.includes("<command-")) {
        return true;
    }
    if (text.includes("<local-command-")) {
        return true;
    }
    return text.includes("<system-reminder>");
}

// (task 56) when the document was built without pre-baseline reconstruction, the git-baseline
// node is the first shown step: every node strictly before its instant is dropped. Without a
// baseline node (e.g. the commit was unreadable, so no beacons were seeded) nothing is hidden —
// never hide work that was not superseded.
function filterPreBaselineNodes(nodes: TimelineNode[], preBaselineSkipped: boolean): TimelineNode[] {
    if (!preBaselineSkipped) {
        return nodes;
    }
    const baselineNode = nodes.find((node) => node.isGitBaseline === true);
    if (baselineNode === undefined) {
        return nodes;
    }
    return nodes.filter((node) => node.when >= baselineNode.when);
}

// One timeline node per conversation turn: every user prompt and agent reply is a numbered step;
// a session-end step closes each session; git commits stay as unnumbered hard stops.
// StepSnapshots attach to the first agent reply of their own session at or after them (tool calls
// run before the reply's text is emitted); leftovers get a synthetic reply node so no file change
// is ever dropped.
export function buildTurnTimelineViewModel(document: WireTimelineDocument, includeAllLines = false): { nodes: TimelineNode[] } {
    const revisionIndex = indexRevisionsByChangeId(document);
    const turnNodes: TurnNode[] = document.messages.map((message) => ({
        kind: message.role === USER_ROLE ? USER_TURN_NODE_KIND : AGENT_TURN_NODE_KIND,
        when: message.timestamp,
        sessionId: message.sessionId,
        uuid: message.uuid,
        text: message.text,
        isSystem: checkMessageTextIsSystem(message.text),
        isOrphaned: message.isOrphaned === true,
        snapshots: [],
        gitOperations: [],
    }));
    // (task 121) commit nodes derive BEFORE snapshots attach so the baseline merge can find the
    // recorded base-commit row; they still join the same sort below.
    const commitNodes = deriveCommitNodes(document);
    attachSnapshotsToAgentTurns(turnNodes, commitNodes, document.steps);
    // (item 55) old: attachGitOperationsToAgentTurns(turnNodes, document.gitOperations ?? []);
    // — git rows generalized into standalone tool-call nodes (every Bash call is a toolCall);
    // gitOperations still feed deriveCommitNodes' hard stops.
    const toolCallNodes = deriveToolCallNodes(document);
    appendSessionEndNodes(turnNodes, toolCallNodes);
    // task 134: opt-in raw-line rows — every transcript record not already a turn/tool row.
    const lineNodes = includeAllLines ? deriveLineNodes(document) : [];
    const sortedNodes = [...turnNodes, ...commitNodes, ...toolCallNodes, ...lineNodes].sort(compareTimelineNodes);
    // (task 56) drop pre-baseline nodes BEFORE numbering so step 1 is the baseline node.
    const nodes = filterPreBaselineNodes(sortedNodes, document.preBaselineSkipped === true);
    assignStepNumbers(nodes);
    deriveNodeFileChanges(nodes, revisionIndex);
    return { nodes };
}
