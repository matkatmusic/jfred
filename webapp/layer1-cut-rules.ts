// Task 383: pure rule that decides why a ruler tick cannot take a jfred cut mark.

export const CutRefusal = {
  noVerifiedNode: "noVerifiedNode",
  notForward: "notForward",
  baseNeedsCommit: "baseNeedsCommit",
} as const;
export type CutRefusal = (typeof CutRefusal)[keyof typeof CutRefusal];

export const CUT_REFUSAL_TEXT: Record<CutRefusal, string> = {
  [CutRefusal.noVerifiedNode]: "No mark here: this time has no verified node (commit, on-disk or snapshot).",
  [CutRefusal.notForward]: "No mark here: marks only extend forward from the last jfred commit.",
  [CutRefusal.baseNeedsCommit]: "No base here: the base must be a commit.",
};

export interface CutFacts {
  isBeacon: boolean;
  isCommit: boolean;
  instantMs: number;
  // Undefined while the branch has no base.
  tipMs: number | undefined;
}

export function findCutRefusal(facts: CutFacts): CutRefusal | undefined {
  if (!facts.isBeacon)
    return CutRefusal.noVerifiedNode;
  if (facts.tipMs === undefined)
    return facts.isCommit ? undefined : CutRefusal.baseNeedsCommit;
  if (facts.instantMs <= facts.tipMs)
    return CutRefusal.notForward;
  return undefined;
}
