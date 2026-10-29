// Opt-in log of which reconstruction stage mutated which file; a no-op until enabled.
// ponytail: global sink, fine for sequential runs; thread a sink if scenarios run concurrently.

import type { Path, Uuid } from "./structures/domain.ts";

// One stage's mutation note: stage name, touched file, optional changeId, detail, optional backup time.
export type ProvenanceEntry = {
  stage: string;
  target: Path;
  changeId?: Uuid;
  detail: string;
  when?: Date;
};

let enabled = false;
let buffer: ProvenanceEntry[] = [];

// Turn provenance on and start a fresh capture (clearing any prior buffer).
export function enableProvenance(): void {
  enabled = true;
  buffer = [];
}

// Turn provenance off; addStageEntry becomes a no-op again.
export function disableProvenance(): void {
  enabled = false;
}

// Record one stage's mutation — a no-op unless provenance is enabled.
export function addStageEntry(entry: ProvenanceEntry): void {
  if (enabled) {
    buffer.push(entry);
  }
}

// Return the captured entries and empty the buffer.
export function getAndClearProvenance(): ProvenanceEntry[] {
  const drained = buffer;
  buffer = [];
  return drained;
}

// Empty the buffer without returning it.
export function clearProvenance(): void {
  buffer = [];
}

