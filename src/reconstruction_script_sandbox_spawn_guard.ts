// Stops a replay from spawning an earlier run; reports or throws on a memo miss.

import { WireNeedState } from "../webapp/layer1-wire-script-results.ts";

export interface EarlierRunReport {
  script: string;
  label: string;
  state: WireNeedState;
}

export class EarlierRunNotSavedError extends Error {
  constructor(label: string) {
    super(`An earlier script run is not saved yet${label}`);
  }
}

interface SpawnGuard {
  neverRunScripts: Set<string>;
  reports: EarlierRunReport[] | undefined;
  isSkippingMisses: boolean;
}

// ponytail: process-wide flag like the exec gate; builds are synchronous.
let activeGuard: SpawnGuard | undefined;

function executeUnderGuard<T>(guard: SpawnGuard, compute: () => T): T {
  const previousGuard = activeGuard;
  activeGuard = guard;
  try {
    return compute();
  }
  finally {
    activeGuard = previousGuard;
  }
}

export function executeWithoutSpawning<T>(neverRunScripts: Set<string>, compute: () => T): T {
  return executeUnderGuard({ neverRunScripts, reports: undefined, isSkippingMisses: false }, compute);
}

export function collectEarlierRuns(neverRunScripts: Set<string>, compute: () => void): EarlierRunReport[] {
  const reports: EarlierRunReport[] = [];
  executeUnderGuard({ neverRunScripts, reports, isSkippingMisses: false }, compute);
  return reports;
}

// With a guard on, a memo miss inside compute returns false: nothing runs, nothing is reported.
export function executeSkippingMisses<T>(compute: () => T): T {
  if (activeGuard === undefined) {
    return compute();
  }
  return executeUnderGuard({ neverRunScripts: activeGuard.neverRunScripts, reports: undefined, isSkippingMisses: true }, compute);
}

// True means go on and spawn; false means the caller returns undefined and stores nothing.
export function assertSpawnAllowed(script: string, label: string): boolean {
  if (activeGuard === undefined) {
    return true;
  }
  const isNeverRun = activeGuard.neverRunScripts.has(script);
  const isSkipped = isNeverRun || activeGuard.isSkippingMisses;
  if (isSkipped) {
    return false;
  }
  if (activeGuard.reports === undefined) {
    throw new EarlierRunNotSavedError(label);
  }
  activeGuard.reports.push({ script, label, state: WireNeedState.unreplayed });
  return false;
}

export function reportMemoHit(script: string, label: string, post: Map<string, string> | undefined): void {
  if (activeGuard?.reports === undefined) {
    return;
  }
  const isNeverRun = activeGuard.neverRunScripts.has(script);
  if (isNeverRun) {
    return;
  }
  if (post === undefined) {
    activeGuard.reports.push({ script, label, state: WireNeedState.replayFailed });
  }
}
