// Task 383: wire types for the jfred commit column; fixture mode only.

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
  base: WireJfredBaseOf<I>;
  commits: WireJfredCommitOf<I>[];
}
