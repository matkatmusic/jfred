// Module-level sink of survived failures, drained into the wire document for the webapp.
// ponytail: global sink like reconstruction_provenance.ts — thread a sink instead only if the engine ever reconstructs sessions concurrently.

import type { Path } from "./structures/domain.ts";
import { FailureScope } from "./structures/vocabulary.ts";

// One survived failure: scope, stage, optional target file, and reason.
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

// Prevents a prior aborted build's leftovers from leaking into the next.
export function clearReconstructionFailures(): void {
    buffer = [];
}
