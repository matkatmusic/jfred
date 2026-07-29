// Task 202 (spec S5): merged multi-session view — shared axis, one end state, re-derived gaps, corroboration marks.

import { LayeredNodeKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import { checkNodeCarriesBytes } from "./layered_anchor.ts";
import { sortNodesOntoAxis } from "./layered_instants.ts";
import { insertPresumedUserEditGaps } from "./layered_end_state.ts";
import type {
    EndStateNode,
    MergedNode,
    MergedTimeline,
    ReconstructionEntity,
    SessionTimeline,
    TimelineNode,
} from "./layered_types.ts";

// One session's evidence node, carrying the session that observed it.
interface OwnedNode {
    node: TimelineNode;
    sessionFile: Path;
}

function checkNodeIsEndState(node: TimelineNode): node is EndStateNode {
    return node.kind === LayeredNodeKind.endState;
}

// End states and gaps are re-derived at merge level, not carried per-session.
function checkNodeIsRederived(node: TimelineNode): boolean {
    if (checkNodeIsEndState(node)) {
        return true;
    }
    return node.kind === LayeredNodeKind.presumedUserEdit;
}

// One session timeline's evidence nodes, each tagged with the session that observed it.
function listSessionEvidenceNodes(sessionTimeline: SessionTimeline): OwnedNode[] {
    return sessionTimeline.timeline.nodes
        .filter((node) => !checkNodeIsRederived(node))
        .map((node) => ({ node, sessionFile: sessionTimeline.sessionFile }));
}

// Every session-owned evidence node across the entity, in session-timeline order.
function listOwnedEvidenceNodes(entity: ReconstructionEntity): OwnedNode[] {
    return entity.sessionTimelines.flatMap(listSessionEvidenceNodes);
}

// All sessions share the same on-disk end state; first match suffices.
// ponytail: every session read one disk — a per-session end-state disagreement would be a loader bug, not a merge case to model.
function findMergedEndStateNode(entity: ReconstructionEntity): EndStateNode | undefined {
    for (const sessionTimeline of entity.sessionTimelines) {
        const endState = sessionTimeline.timeline.nodes.find(checkNodeIsEndState);
        if (endState !== undefined) {
            return endState;
        }
    }
    return undefined;
}

// Groups byte-carrying nodes by content, mapping each to the distinct sessions that saw it.
function listSessionsByContent(owned: OwnedNode[]): Map<string, Path[]> {
    const sessionsByContent = new Map<string, Path[]>();
    for (const entry of owned) {
        if (!checkNodeCarriesBytes(entry.node)) {
            continue;
        }
        const sessions = sessionsByContent.get(entry.node.content) ?? [];
        sessionsByContent.set(entry.node.content, sessions);
        const alreadyListed = sessions.some(
            (session) => session.toString() === entry.sessionFile.toString(),
        );
        if (alreadyListed) {
            continue;
        }
        sessions.push(entry.sessionFile);
    }
    return sessionsByContent;
}

// Returns other sessions that independently observed the same content (requires two or more).
function listCorroboratingSessions(
    node: TimelineNode,
    ownSession: Path | undefined,
    sessionsByContent: Map<string, Path[]>,
): Path[] {
    if (!checkNodeCarriesBytes(node)) {
        return [];
    }
    const sessions = sessionsByContent.get(node.content) ?? [];
    if (sessions.length < 2) {
        return [];
    }
    return sessions.filter((session) => session.toString() !== ownSession?.toString());
}

// Merges all session timelines for one entity onto a shared axis with corroboration marks.
export function mergeSessionTimelines(entity: ReconstructionEntity): MergedTimeline {
    const owned = listOwnedEvidenceNodes(entity);
    const ownerBySessionNode = new Map<TimelineNode, Path>(
        owned.map((entry) => [entry.node, entry.sessionFile]),
    );
    const sorted = sortNodesOntoAxis(owned.map((entry) => entry.node));
    const endState = findMergedEndStateNode(entity);
    const positioned = endState === undefined ? sorted : [...sorted, endState];
    const sessionsByContent = listSessionsByContent(owned);
    const nodes: MergedNode[] = insertPresumedUserEditGaps(positioned).map((node) => {
        const sessionFile = ownerBySessionNode.get(node);
        return {
            node,
            sessionFile,
            corroboratedBy: listCorroboratingSessions(node, sessionFile, sessionsByContent),
        };
    });
    return { nodes };
}

