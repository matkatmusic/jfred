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
}

// ponytail: process-wide flag like the exec gate; builds are synchronous.
let activeGuard: SpawnGuard | undefined;

function runUnderGuard<T>(guard: SpawnGuard, compute: () => T): T {
  const previousGuard = activeGuard;
  activeGuard = guard;
  try {
    return compute();
  }
  finally {
    activeGuard = previousGuard;
  }
}

export function runWithoutSpawning<T>(neverRunScripts: Set<string>, compute: () => T): T {
  return runUnderGuard({ neverRunScripts, reports: undefined }, compute);
}

export function runCollectingEarlierRuns(neverRunScripts: Set<string>, compute: () => void): EarlierRunReport[] {
  const reports: EarlierRunReport[] = [];
  runUnderGuard({ neverRunScripts, reports }, compute);
  return reports;
}

// True means go on and spawn; false means the caller returns undefined and stores nothing.
export function assertSpawnAllowed(script: string, label: string): boolean {
  if (activeGuard === undefined) {
    return true;
  }
  if (activeGuard.neverRunScripts.has(script)) {
    return false;
  }
  if (activeGuard.reports === undefined) {
    throw new EarlierRunNotSavedError(label);
  }
  activeGuard.reports.push({ script, label, state: WireNeedState.unreplayed });
  return false;
}

export function noteMemoHit(script: string, label: string, post: Map<string, string> | undefined): void {
  if (activeGuard?.reports === undefined) {
    return;
  }
  if (activeGuard.neverRunScripts.has(script)) {
    return;
  }
  if (post === undefined) {
    activeGuard.reports.push({ script, label, state: WireNeedState.replayFailed });
  }
}
