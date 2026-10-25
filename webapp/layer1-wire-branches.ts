// Layer 1's branch-lane vocabulary on the wire (task 357).

import type { WireInstantOf } from "./layer1-wire.ts";

export const WireRewindKind = {
  code: "code",
  conversation: "conversation",
} as const;
export type WireRewindKind = (typeof WireRewindKind)[keyof typeof WireRewindKind];

// Task 379 mockup types, replaced by WireBranchOf (task 357):
// export interface WireMockBranchNodeOf<I> extends WireInstantOf<I> { label: string }
// export interface WireMockBranchOf<I> { rewindKind: WireRewindKind; forkFrom: I; rejoinAt?: I; nodes: WireMockBranchNodeOf<I>[] }

// Task 357: a node on a branch lane; changeId is the tool_use id, label is the EventKind word.
export interface WireBranchNodeOf<I, U> extends WireInstantOf<I> {
  changeId: U;
  label: string;
}

// Task 357: one real branch lane.
export interface WireBranchOf<I, U> {
  rewindKind: WireRewindKind;
  // Rewind-point record time: the elbow leaves the trunk rail here, no dot.
  forkAt: WireInstantOf<I>;
  // Conversation only: the trunk node the kept bytes flow into.
  rejoinAt?: WireInstantOf<I>;
  // Conversation only, mutually exclusive with rejoinAt: kept bytes with no later trunk revision, so the client rejoins at the pair's rail end.
  keptToEnd?: true;
  nodes: WireBranchNodeOf<I, U>[];
}

// Task 357: /api/layer1-branches answers without axisPx, as /api/layer1-edits does.
export interface WireBranchesViewOf<I, P, U> {
  pairs: {
    path: P;
    branches: {
      rewindKind: WireRewindKind;
      forkAt: I;
      rejoinAt?: I;
      keptToEnd?: true;
      nodes: Omit<WireBranchNodeOf<I, U>, "axisPx">[];
    }[];
  }[];
}

// export type WireMockBranch = WireMockBranchOf<string>;
export type WireBranch = WireBranchOf<string, string>;
export type WireBranchesView = WireBranchesViewOf<string, string, string>;
