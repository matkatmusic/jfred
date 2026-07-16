// Structural discovery of rewound branches that the `last-prompt` head path misses: an abandoned
// branch that edited a file but whose tip is named by no last-prompt record (the rewind re-prompted
// from the fork point, so no head ever pointed at the abandoned tip). The only structural signal is
// the parentUuid fork — a record parenting ≥2 genuine user prompts. This is the home for that forest
// logic, kept out of reconstruction_branch.ts and reconstruction_tree.ts (both at the 250-line cap).
// The ConversationBranch type is imported type-only, so there is no runtime import cycle with
// reconstruction_branch.ts. See plans/s13/s13-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { Uuid } from "./structures/domain.ts";
import type { ConversationBranch } from "./reconstruction_branch.ts";
import {
    collectDescendantUuids,
    findDeepestPromptOrReply,
} from "./reconstruction_tree.ts";
import {
    findPromptForkPoints,
    isGenuineUserPrompt,
} from "./reconstruction_prompts.ts";

// The rewound branches discovered structurally from the parentUuid forks, none of which is already
// represented by an existing (head-based) tip. Purely additive: the dedup guard skips any abandoned
// subtree that already holds an existing tip, so head-based scenarios (S7/S8/S11/S12) gain nothing.
export function findStructuralRewoundBranches(
    records: TranscriptRecord[],
    existingTips: Set<string>,
): ConversationBranch[] {
    const claimed = new Set<string>(existingTips);
    const found: ConversationBranch[] = [];
    for (const forkPoint of findPromptForkPoints(records)) {
        found.push(...rewoundBranchesAtFork(records, forkPoint, claimed));
    }
    return found;
}

// The abandoned branches at one fork: its genuine-prompt children ordered by time, the latest being
// the surviving-side continuation (skipped), each earlier one an abandoned branch (when not deduped).
// Adds every kept branch's tip to `claimed` so a later fork cannot re-discover the same tip.
function rewoundBranchesAtFork(
    records: TranscriptRecord[],
    forkPoint: Uuid,
    claimed: Set<string>,
): ConversationBranch[] {
    const children = genuinePromptChildrenOf(records, forkPoint);
    if (children.length < 2) {
        return [];
    }
    const abandoned = children.slice(0, children.length - 1);
    const branches: ConversationBranch[] = [];
    for (const prompt of abandoned) {
        const branch = buildRewoundBranchForPrompt(records, forkPoint, prompt.uuid!, claimed);
        if (branch !== undefined) {
            branches.push(branch);
            claimed.add(branch.tip.toString());
        }
    }
    return branches;
}

// One abandoned prompt's rewound branch, or undefined when the dedup guard rejects it (its subtree
// already holds a represented tip) or it has no conversational tip.
function buildRewoundBranchForPrompt(
    records: TranscriptRecord[],
    forkPoint: Uuid,
    abandonedPrompt: Uuid,
    claimed: Set<string>,
): ConversationBranch | undefined {
    if (subtreeHoldsClaimedTip(records, abandonedPrompt, claimed)) {
        return undefined;
    }
    const tip = findDeepestPromptOrReply(records, abandonedPrompt);
    if (tip === undefined) {
        return undefined;
    }
    if (claimed.has(tip.toString())) {
        return undefined;
    }
    return { tip, rewindPoint: forkPoint, isSurviving: false };
}

// The genuine-prompt children of `forkPoint`, ordered by timestamp ascending.
function genuinePromptChildrenOf(
    records: TranscriptRecord[],
    forkPoint: Uuid,
): TranscriptRecord[] {
    const children = records.filter((record) => isPromptChildOf(record, forkPoint));
    return children.sort((left, right) => promptTime(left) - promptTime(right));
}

// True when `record` is a genuine user prompt whose parent is `forkPoint`.
function isPromptChildOf(record: TranscriptRecord, forkPoint: Uuid): boolean {
    const parent = record.parentUuid;
    if (parent === undefined) {
        return false;
    }
    if (parent === null) {
        return false;
    }
    if (parent.toString() !== forkPoint.toString()) {
        return false;
    }
    return isGenuineUserPrompt(record);
}

// The record's epoch-ms timestamp (0 when absent), for ascending child ordering.
function promptTime(record: TranscriptRecord): number {
    return record.timestamp?.getTime() ?? 0;
}

// True when any record in the abandoned prompt's subtree is already a claimed tip — the regression
// guard that prevents double-counting branches the head path already enumerated. The prompt itself is
// intentionally NOT treated as its own claimed tip: in S14 the abandoned prompt is also a last-prompt
// head, so a self-match would block discovery of the deeper real `farewell` tip. collectDescendantUuids
// excludes `start`, so S7/S8/S11/S12 (whose claimed head tip is a descendant) stay skipped.
function subtreeHoldsClaimedTip(
    records: TranscriptRecord[],
    abandonedPrompt: Uuid,
    claimed: Set<string>,
): boolean {
    const subtree = collectDescendantUuids(records, abandonedPrompt);
    for (const tip of claimed) {
        if (subtree.has(tip)) {
            return true;
        }
    }
    return false;
}

