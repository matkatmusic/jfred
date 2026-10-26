// Task 329/356: one path's diffable revision ladder, shared by the file-nav drawer and the script-run drawer.

import type { DiffStep } from "./layer1-diff-pane.ts";
import { describeCommitStep, describeDiskStep, describeSnapshotStep } from "./layer1-revision-sources.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

type DatedStep = { instant: string; step: DiffStep };

function compareDatedSteps(a: DatedStep, b: DatedStep): number {
  return Date.parse(a.instant) - Date.parse(b.instant);
}

// Every diffable revision of one path with its instant, oldest first: commits, snapshots, disk.
export function listDatedSteps(view: WireLayer1View, path: string): DatedStep[] {
  let pair: WireLayer1View["pairs"][number] | undefined;
  for (const candidate of view.pairs) {
    const isMatch = candidate.path === path;
    if (isMatch) {
      pair = candidate;
      break;
    }
  }
  let diskOrphan: WireLayer1View["diskOrphans"][number] | undefined;
  for (const candidate of view.diskOrphans) {
    const isMatch = candidate.path === path;
    if (isMatch) {
      diskOrphan = candidate;
      break;
    }
  }
  const hasNoPair = pair === undefined;
  const hasNoDiskOrphan = diskOrphan === undefined;
  const hasNeither = hasNoPair && hasNoDiskOrphan;
  if (hasNeither) {
    return [];
  }
  const dated: DatedStep[] = [];
  for (const commit of pair?.commits ?? []) {
    dated.push({ instant: commit.instant, step: describeCommitStep(path, commit.hash) });
  }
  for (const snapshot of (pair?.snapshots ?? diskOrphan?.snapshots) ?? []) {
    dated.push({ instant: snapshot.instant, step: describeSnapshotStep(path, snapshot) });
  }
  dated.push({ instant: (pair?.onDisk ?? diskOrphan!).instant, step: describeDiskStep(path) });
  return dated.sort(compareDatedSteps);
}

// The steps alone, order preserved; the nav flow needs no instants.
export function listDiffableSteps(view: WireLayer1View, path: string): DiffStep[] {
  const steps: DiffStep[] = [];
  for (const entry of listDatedSteps(view, path)) {
    steps.push(entry.step);
  }
  return steps;
}

// Task 356: brackets a run's instant between the nearest before/after steps on path's ladder.
export function computeRunBracket(
  view: WireLayer1View, path: string, runInstant: string,
): { baseIndex: number; targetIndex: number } | undefined {
  const dated = listDatedSteps(view, path);
  if (dated.length === 0) {
    return undefined;
  }
  const runTime = Date.parse(runInstant);
  let lastBefore = -1;
  for (let index = dated.length - 1; index >= 0; index -= 1) {
    const stepTime = Date.parse(dated[index]!.instant);
    if (stepTime <= runTime) {
      lastBefore = index;
      break;
    }
  }
  let firstAfter = -1;
  for (let index = 0; index < dated.length; index += 1) {
    const stepTime = Date.parse(dated[index]!.instant);
    if (stepTime >= runTime) {
      firstAfter = index;
      break;
    }
  }
  return {
    baseIndex: lastBefore === -1 ? 0 : lastBefore,
    targetIndex: firstAfter === -1 ? dated.length - 1 : firstAfter,
  };
}
