// Task 202 (spec S5): the DERIVED merged view of one ReconstructionEntity. The per-session
// SessionTimelines stay the stored truth (Q13) — this module orders their nodes on the one
// instant axis, keeps ONE on-disk end state instead of one per session, re-derives the
// presumption gaps against the merged neighbours, and marks nodes whose bytes two distinct
// sessions both observed (the input for spec S8's dashed cross-lane lines).

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

// Whether the merge re-derives this node instead of carrying the per-session one over: end
// states dedupe to one (one file, one disk), and gaps are recomputed because another session's
// beacon may explain a diff the owning session could not.
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

// The entity's one end state: task 199 appends the same on-disk state to every session
// timeline, so the first one found is it.
// ponytail: every session read one disk — a per-session end-state disagreement would be a
// loader bug, not a merge case to model.
function findMergedEndStateNode(entity: ReconstructionEntity): EndStateNode | undefined {
    for (const sessionTimeline of entity.sessionTimelines) {
        const endState = sessionTimeline.timeline.nodes.find(checkNodeIsEndState);
        if (endState !== undefined) {
            return endState;
        }
    }
    return undefined;
}

// The DISTINCT sessions that observed each byte content. Byteless nodes (stubs, gaps, script
// runs) observe nothing, so they never enter a group.
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

// The sessions whose bytes corroborate this node: none unless at least two DISTINCT sessions
// observed the content (one session repeating itself corroborates nothing — spec S5's
// degenerate case), otherwise the group minus this node's own session. A node owned by no
// session (the end state) subtracts nothing, so every observer corroborates it.
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

// One entity's merged multi-session view: every session's evidence on the shared axis, the one
// end state appended POSITIONALLY last (spec S2's rule, unchanged by the merge), merged-level
// presumption gaps, and corroboration marks. Spec S8 calls this per entity — there is no
// graph-level wrapper by design.
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
