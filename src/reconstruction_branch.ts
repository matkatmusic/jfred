// Conversation-branch model: rewind forks, surviving vs abandoned head selection, branch record filtering.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid, type Path } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import {
    collectAncestorUuids,
    collectHeadUuids,
    findHeadAtOrAbove,
} from "./reconstruction_tree.ts";
import {
    collectAbandonedHeads,
    collectSurvivingTrunkUuids,
    findRewindPoint,
} from "./reconstruction_trunk.ts";
import { findWorkingTreeOwner } from "./reconstruction_worktree.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { findStructuralRewoundBranches } from "./reconstruction_fork.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type {
    BranchedReconstruction,
    FileHistory,
} from "./reconstruction_engine.ts";

// A parentUuid-tree branch named by its tip; surviving if final, rewound if abandoned.
export type ConversationBranch = {
    tip: Uuid;
    rewindPoint: Uuid | undefined;
    isSurviving: boolean;
};

// Picks the working-tree-owning head when a rewind left it off the final head's chain.
function findSurvivingHead(records: TranscriptRecord[]): Uuid | undefined {
    const heads = collectHeadUuids(records);
    if (heads.length === 0) {
        return undefined;
    }
    const finalHead = heads[heads.length - 1]!;
    const owner = findWorkingTreeOwner(records);
    if (owner === undefined) {
        return finalHead;
    }
    const finalChain = collectAncestorUuids(records, finalHead);
    if (finalChain.has(owner.toString())) {
        return finalHead;
    }
    const workingTreeHead = findHeadAtOrAbove(records, owner);
    if (workingTreeHead === undefined) {
        return finalHead;
    }
    if (survivingBranchRecordsFileChange(records, finalHead)) {
        return finalHead;
    }
    return workingTreeHead;
}

// S14: skip owner-redirect when the final-head branch has its own file events.
function survivingBranchRecordsFileChange(
    records: TranscriptRecord[],
    finalHead: Uuid,
): boolean {
    return extractFileEvents(selectBranchRecords(records, finalHead)).length > 0;
}

// Returns surviving + rewound branches; empty when no surviving head exists.
export function findConversationBranches(
    records: TranscriptRecord[],
): ConversationBranch[] {
    reportReconstructionProgress("locating surviving head");
    const survivingHead = findSurvivingHead(records);
    if (survivingHead === undefined) {
        return [];
    }
    reportReconstructionProgress("collecting surviving trunk uuids");
    const survivingSet = collectSurvivingTrunkUuids(records, survivingHead);
    const branches: ConversationBranch[] = [
        { tip: survivingHead, rewindPoint: undefined, isSurviving: true },
    ];
    reportReconstructionProgress("collecting abandoned heads");
    const abandonedTips = collectAbandonedHeads(records, survivingSet);
    for (const [tipIndex, tip] of abandonedTips.entries()) {
        // task 163: report per-tip progress so the branch-construction stage shows motion.
        reportReconstructionProgress("scanning branch tips", tipIndex + 1, abandonedTips.length);
        const rewindPoint = findRewindPoint(records, tip, survivingSet);
        branches.push({ tip, rewindPoint, isSurviving: false });
    }
    const existingTips = new Set(branches.map((branch) => branch.tip.toString()));
    reportReconstructionProgress("scanning structural forks");
    branches.push(...findStructuralRewoundBranches(records, existingTips));
    return branches;
}

// Branch selections memoized per records-array identity. Downstream caches (executeRunOnce's
// per-array script memo, reconstructFileOver's history memo) key on the records array's IDENTITY;
// re-filtering a fresh array for the same (records, tip) on every call silently defeated them,
// so every document pass re-ran every sandbox script. Same inputs → the same array instance.
// corpus: moved to reconstruction_corpus.ts (item 14)
// const branchSelections = new WeakMap<TranscriptRecord[], Map<string, TranscriptRecord[]>>();

// Selects tip's ancestor chain plus uuid-less meta records; falls back to all records.
export function selectBranchRecords(
    records: TranscriptRecord[],
    tip: Uuid,
): TranscriptRecord[] {
    // corpus: moved to reconstruction_corpus.ts (item 14)
    // let byTip = branchSelections.get(records);
    // if (byTip === undefined) {
    //     byTip = new Map<string, TranscriptRecord[]>();
    //     branchSelections.set(records, byTip);
    // }
    const byTip = getCorpusState(records).branchSelectionsByTip;
    const tipKey = tip.toString();
    const cached = byTip.get(tipKey);
    if (cached !== undefined) {
        return cached;
    }
    const selected = computeBranchRecords(records, tip);
    byTip.set(tipKey, selected);
    return selected;
}

function computeBranchRecords(
    records: TranscriptRecord[],
    tip: Uuid,
): TranscriptRecord[] {
    const branchUuids = collectAncestorUuids(records, tip);
    if (branchUuids.size === 0) {
        return records;
    }
    const selected = records.filter(
        (record) => record.uuid === undefined || branchUuids.has(record.uuid.toString()),
    );
    // Nothing dropped: keep the input's identity so downstream identity-keyed memos hit.
    if (selected.length === records.length) {
        return records;
    }
    return selected;
}

// Live-branch selections memoized per records-array identity, for the same reason as
// branchSelections above: downstream memos key on the selected array's IDENTITY.
// corpus: moved to reconstruction_corpus.ts (item 14)
// const liveBranchSelections = new WeakMap<TranscriptRecord[], TranscriptRecord[]>();

// Surviving trunk records; falls back to all records when no last-prompt head exists.
export function selectLiveBranch(
    records: TranscriptRecord[],
): TranscriptRecord[] {
    const survivingHead = findSurvivingHead(records);
    if (survivingHead === undefined) {
        // No surviving head: fall back to all records WITHOUT caching (the corpus's liveBranch stays undefined = not cached).
        return records;
    }
    // corpus: moved to reconstruction_corpus.ts (item 14)
    // const cached = liveBranchSelections.get(records);
    const state = getCorpusState(records);
    const cached = state.liveBranch;
    if (cached !== undefined) {
        return cached;
    }
    const trunkUuids = collectSurvivingTrunkUuids(records, survivingHead);
    let selected = records.filter(
        (record) => record.uuid === undefined || trunkUuids.has(record.uuid.toString()),
    );
    // Nothing dropped: keep the input's identity so downstream identity-keyed memos hit.
    if (selected.length === records.length) {
        selected = records;
    }
    // corpus: moved to reconstruction_corpus.ts (item 14)
    // liveBranchSelections.set(records, selected);
    state.liveBranch = selected;
    return selected;
}

// Surviving trunk uuid strings across all session trees; empty without a surviving head.
export function collectSurvivingUuids(
    records: TranscriptRecord[],
): Set<string> {
    const survivingHead = findSurvivingHead(records);
    if (survivingHead === undefined) {
        return new Set<string>();
    }
    return collectSurvivingTrunkUuids(records, survivingHead);
}

// Canonical short-id: first 8 chars of a branch tip's uuid string.
export function shortUuid(uuid: Uuid): string {
    return uuid.toString().slice(0, 8);
}

// Looks up branch histories by id: "surviving" or a rewound tip's short uuid.
export function findBranchById(
    branched: BranchedReconstruction,
    id: string,
): FileHistory[] | undefined {
    if (id === "surviving") {
        return branched.surviving;
    }
    const match = branched.rewound.find((entry) => shortUuid(entry.tip) === id);
    if (match === undefined) {
        return undefined;
    }
    return match.histories;
}

// Return the first file deleted on the surviving branch, if any, as a default target.
export function findDeletedTarget(
    records: TranscriptRecord[],
): Path | undefined {
    const deletion = extractFileEvents(selectLiveBranch(records)).find(
        (event) => event.kind === EventKind.delete,
    );
    return deletion?.kind === EventKind.delete ? deletion.target : undefined;
}

