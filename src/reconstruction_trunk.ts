// Surviving-trunk and abandoned-head helpers for the conversation-branch model
// (reconstruction_branch.ts): head ancestor chains, predecessor-tree final heads, the surviving
// trunk uuid set, rewind-point walks, and maximal-tip dedup of abandoned heads.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid } from "./structures/domain.ts";
import { absorbParallelToolCallSiblings } from "./reconstruction_trunk_absorb.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import {
    collectAncestorUuids,
    collectHeadUuids,
    indexRecordsByUuid,
} from "./reconstruction_tree.ts";

// The ancestor-chain uuid set of every head, keyed by head uuid string — computed once so the
// tree grouping below reads each chain a single time. Each walk is O(records) (per-call uuid
// re-index in collectAncestorUuids), so on a many-session merged corpus this loop is the slow
// part of branch enumeration — announce per-head motion for the stage-level heartbeat.
function mapHeadChains(records: TranscriptRecord[], heads: Uuid[]): Map<string, Set<string>> {
    const chains = new Map<string, Set<string>>();
    for (const [headIndex, head] of heads.entries()) {
        reportReconstructionProgress("charting conversation heads", headIndex + 1, heads.length);
        chains.set(head.toString(), collectAncestorUuids(records, head));
    }
    return chains;
}

// True when the two chains share any uuid — their heads fork from a common record and belong to
// the same conversation tree.
function checkChainsOverlap(a: Set<string>, b: Set<string>): boolean {
    for (const uuid of a) {
        if (b.has(uuid)) {
            return true;
        }
    }
    return false;
}

// The final head of every conversation tree the surviving head does NOT belong to. A multi-session
// project (EndCurrentAgentAndSpawnNewAgent) is a FOREST of parentUuid-disconnected trees — each
// predecessor session is a completed chapter whose final head the next session continues from, so
// its chain is surviving trunk, never a rewound branch. Rewinds only exist WITHIN a tree.
function collectPredecessorFinalHeads(records: TranscriptRecord[], survivingHead: Uuid): Uuid[] {
    const heads = dedupeUuids(collectHeadUuids(records));
    const chains = mapHeadChains(records, heads);
    const survivingChain = chains.get(survivingHead.toString()) ?? collectAncestorUuids(records, survivingHead);
    const trees: { chainUnion: Set<string>; finalHead: Uuid }[] = [];
    for (const head of heads) {
        const chain = chains.get(head.toString())!;
        if (checkChainsOverlap(chain, survivingChain)) {
            continue;
        }
        const tree = trees.find((entry) => checkChainsOverlap(entry.chainUnion, chain));
        if (tree === undefined) {
            trees.push({ chainUnion: new Set(chain), finalHead: head });
            continue;
        }
        for (const uuid of chain) {
            tree.chainUnion.add(uuid);
        }
        tree.finalHead = head;
    }
    return trees.map((tree) => tree.finalHead);
}

// The uuid strings on the surviving trunk across every session tree: the surviving head's own
// chain plus each predecessor tree's final-head chain, with same-turn parallel-tool-call
// siblings absorbed (task 145).
export function collectSurvivingTrunkUuids(records: TranscriptRecord[], survivingHead: Uuid): Set<string> {
    const trunk = collectAncestorUuids(records, survivingHead);
    for (const head of collectPredecessorFinalHeads(records, survivingHead)) {
        for (const uuid of collectAncestorUuids(records, head)) {
            trunk.add(uuid);
        }
    }
    absorbParallelToolCallSiblings(records, trunk);
    return trunk;
}


// The rewind point of an abandoned tip: the deepest record on the tip's path that also lies on the
// surviving path — found by walking tip -> root and returning the first uuid in `survivingSet`.
export function findRewindPoint(
    records: TranscriptRecord[],
    tip: Uuid,
    survivingSet: Set<string>,
): Uuid | undefined {
    const byUuid = indexRecordsByUuid(records);
    const visited = new Set<string>();
    let current = byUuid.get(tip.toString());
    while (current !== undefined) {
        const key = current.uuid!.toString();
        if (visited.has(key)) {
            return undefined;
        }
        visited.add(key);
        if (survivingSet.has(key)) {
            return current.uuid;
        }
        const parent = current.parentUuid;
        if (parent === undefined) {
            return undefined;
        }
        if (parent === null) {
            return undefined;
        }
        current = byUuid.get(parent.toString());
    }
    return undefined;
}

// Deduplicate uuids by their string value, preserving first-seen order.
function dedupeUuids(uuids: Uuid[]): Uuid[] {
    const seen = new Set<string>();
    const unique: Uuid[] = [];
    for (const uuid of uuids) {
        if (!seen.has(uuid.toString())) {
            seen.add(uuid.toString());
            unique.push(uuid);
        }
    }
    return unique;
}

// True when `head` is a maximal tip among the abandoned heads — i.e. it is NOT an ancestor of any
// other abandoned head. (A head that lies on another abandoned head's chain is an interior node of
// that deeper branch, not a branch tip of its own.)
function isMaximalTip(
    head: Uuid,
    abandoned: Uuid[],
    chains: Map<string, Set<string>>,
): boolean {
    for (const other of abandoned) {
        if (other.toString() === head.toString()) {
            continue;
        }
        // const otherAncestors = collectAncestorUuids(records, other);  // pre-charted below
        if (chains.get(other.toString())!.has(head.toString())) {
            return false;
        }
    }
    return true;
}

// The abandoned (rewound) heads: heads not on the surviving chain, deduped to maximal tips.
// Chains are charted ONCE via mapHeadChains — the per-pair collectAncestorUuids walks this
// replaces were O(heads² × records) and stalled real multi-session projects for hours inside
// "finding conversation branches" with no progress output.
export function collectAbandonedHeads(
    records: TranscriptRecord[],
    survivingSet: Set<string>,
): Uuid[] {
    const heads = dedupeUuids(collectHeadUuids(records));
    const abandoned = heads.filter((head) => !survivingSet.has(head.toString()));
    const chains = mapHeadChains(records, abandoned);
    return abandoned.filter((head) => isMaximalTip(head, abandoned, chains));
}
