// Provenance sink: an opt-in, module-level log of which reconstruction STAGE mutated which file, so the
// coverage checker can name the stage function responsible for a mismatched step. Disabled by default, so
// the engine/CLI/test reconstruction paths are an unobserved no-op until a caller turns it on.
// ponytail: global sink — correct for the script's sequential per-scenario runs; thread a sink instead only
// if the engine ever reconstructs scenarios concurrently.
// Design: plans/i-need-a-script-peppy-twilight.md (Phase 2).

import type { Path, Uuid } from "./structures/domain.ts";

// One stage's mutation note: the stage function name, the file it touched, the driving changeId (when one
// applies), a one-line detail, and the backup time it used (when one applies).
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

// Turn provenance off; noteStage becomes a no-op again.
export function disableProvenance(): void {
    enabled = false;
}

// Record one stage's mutation — a no-op unless provenance is enabled.
export function noteStage(entry: ProvenanceEntry): void {
    if (enabled) {
        buffer.push(entry);
    }
}

// Return the captured entries and empty the buffer.
export function drainProvenance(): ProvenanceEntry[] {
    const drained = buffer;
    buffer = [];
    return drained;
}

// Empty the buffer without returning it.
export function clearProvenance(): void {
    buffer = [];
}

