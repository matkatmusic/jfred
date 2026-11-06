// Task 383: module state for the jfred branch; a filter redraw drops the view field.

import { JFRED_SHORT_HASH_LENGTH } from "./layer1-wire-jfred.ts";
import type { WireJfredBaseOf, WireJfredCommitOf, WireJfredCommitRequest } from "./layer1-wire-jfred.ts";
import type { WireLayer1View } from "../../layer1-wire.ts";
import { isRunConsentAllowed } from "../popups/layer1-run-consent.ts";

export type JfredBase = WireJfredBaseOf<string>;
export type JfredCommit = WireJfredCommitOf<string>;
export interface JfredDraft {
  instant: string;
  message: string;
}
export interface JfredBranch {
  base?: JfredBase;
  commits: JfredCommit[];
  pending?: JfredDraft;
  isArmed: boolean;
  isCanned: boolean;
}

// const COMMIT_HASH_PREFIX = "c0ffee";
const branch: JfredBranch = { commits: [], isArmed: false, isCanned: false };

export function readJfredBranch(): JfredBranch {
  return branch;
}

export function loadJfredBranch(view: WireLayer1View): void {
  branch.base = view.jfredCommits?.base;
  branch.commits = [...(view.jfredCommits?.commits ?? [])];
  branch.pending = undefined;
  branch.isCanned = view.jfredCommits?.isCanned === true;
}

export function setArmed(isOn: boolean): void {
  branch.isArmed = isOn;
}

export function setBase(base: JfredBase): void {
  branch.base = base;
}

export function setPending(draft: JfredDraft | undefined): void {
  branch.pending = draft;
}

export function deleteJfredBranch(): void {
  branch.base = undefined;
  branch.commits = [];
  branch.pending = undefined;
}

// function readTipHash(): string {
//   const tip = branch.commits.at(-1) ?? branch.base;
//   if (tip === undefined)
//     throw new Error("jfred branch has no base");
//   return tip.shortHash;
// }

// export function commitPending(): JfredCommit {
//   if (branch.pending === undefined)
//     throw new Error("no pending jfred mark to commit");
//   const counter = String(branch.commits.length + 1).padStart(2, "0");
//   const made = { ...branch.pending, shortHash: `${COMMIT_HASH_PREFIX}${counter}`, parentShortHash: readTipHash() };
//   branch.commits.push(made);
//   branch.pending = undefined;
//   return made;
// }

export function appendCommit(commit: JfredCommit): void {
  branch.commits.push(commit);
  branch.pending = undefined;
}

export function buildCommitRequest(): WireJfredCommitRequest {
  if (branch.pending === undefined)
    throw new Error("no pending jfred mark to commit");
  if (branch.base === undefined)
    throw new Error("jfred branch has no base");
  const tip = branch.commits.at(-1);
  const parentShortHash = tip === undefined ? undefined : tip.shortHash;
  return {
    baseShortHash: branch.base.shortHash,
    parentShortHash,
    markInstant: branch.pending.instant,
    message: branch.pending.message,
    allowScripts: isRunConsentAllowed(),
  };
}

export function applyBaseFromHash(view: WireLayer1View, savedHash: string): void {
  for (const pair of view.pairs) {
    for (const commit of pair.commits) {
      if (commit.hash === savedHash) {
        branch.base = { instant: commit.instant, shortHash: savedHash.slice(0, JFRED_SHORT_HASH_LENGTH) };
        return;
      }
    }
  }
}

export function readTipMs(): number | undefined {
  const tip = branch.commits.at(-1) ?? branch.base;
  return tip === undefined ? undefined : Date.parse(tip.instant);
}
