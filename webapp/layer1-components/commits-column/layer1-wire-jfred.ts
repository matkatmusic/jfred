// Task 383: wire types for the jfred commit column; Task 361 adds the commit request and reply.

export const JFRED_BRANCH_NAME = "jfred";
export const JFRED_SUBJECT_PREFIX = "jfred: reconstruct to ";
export const JFRED_SHORT_HASH_LENGTH = 8;

export interface WireJfredCommitOf<I> {
  instant: I;
  shortHash: string;
  parentShortHash: string;
  message: string;
}

export interface WireJfredBaseOf<I> {
  instant: I;
  shortHash: string;
}

export interface WireJfredCommitsOf<I> {
  // Undefined while no base is chosen and no jfred branch exists.
  base?: WireJfredBaseOf<I>;
  commits: WireJfredCommitOf<I>[];
  // Only the fixture sets it: the canned view loads once and stays DOM-only.
  isCanned?: true;
}

// POST body of /api/layer1-jfred-commit; parentShortHash is undefined only for the first commit.
export interface WireJfredCommitRequestOf<I> {
  baseShortHash: string;
  parentShortHash?: string;
  markInstant: I;
  message: string;
  // The page's run-consent answer: scripts count in the Commit only when true.
  allowScripts: boolean;
}

export const JfredCommitOutcome = { committed: "committed", unchanged: "unchanged", unrebuilt: "unrebuilt" } as const;

// Reply of /api/layer1-jfred-commit; `unchanged` and `unrebuilt` write nothing; unrebuilt paths are project-relative and sorted.
export type WireJfredCommitReplyOf<I> =
  | { outcome: typeof JfredCommitOutcome.committed; commit: WireJfredCommitOf<I> }
  | { outcome: typeof JfredCommitOutcome.unchanged; nextInstant?: I }
  | { outcome: typeof JfredCommitOutcome.unrebuilt; paths: string[]; nextInstant: I };

export type WireJfredCommitRequest = WireJfredCommitRequestOf<string>;
export type WireJfredCommitReply = WireJfredCommitReplyOf<string>;
