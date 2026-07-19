// Partial-reconstruction health sink: a module-level log of every failure the engine survived
// (skipped stages, unrecoverable events, dead document phases), drained into the wire document
// so the webapp can mark what was NOT recovered. Always on — entries only exist on failure.
// ponytail: global sink like reconstruction_provenance.ts — thread a sink instead only if the
// engine ever reconstructs sessions concurrently.

import type { Path } from "./structures/domain.ts";
import { FailureScope } from "./structures/vocabulary.ts";

// One survived failure: which scope caught it, the stage/phase function name, the file it
// affects (when one applies), and a one-line human reason.
export type ReconstructionFailure = {
    scope: FailureScope;
    stage: string;
    target?: Path;
    reason: string;
};

let buffer: ReconstructionFailure[] = [];

// Record one survived failure.
export function noteReconstructionFailure(failure: ReconstructionFailure): void {
    buffer.push(failure);
}

// Return the captured failures and empty the buffer.
export function drainReconstructionFailures(): ReconstructionFailure[] {
    const drained = buffer;
    buffer = [];
    return drained;
}

// Empty the buffer without returning it (call at the start of a build so a previous build's
// aborted leftovers cannot leak in).
export function clearReconstructionFailures(): void {
    buffer = [];
}
