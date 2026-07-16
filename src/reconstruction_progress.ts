// Progress announcements from deep inside the synchronous reconstruction pipeline, streamed to
// the viewer's loading console. Mirrors reconstruction_exec_gate.ts: a build-scoped module-level
// sink set by the viewer around a build and cleared after; undefined otherwise, so the CLI,
// tests, and engine callers stay silent.
// ponytail: process-wide sink, not per-call threading — builds are synchronous and the server
// serializes them; thread an options object through reconstruct* if that changes.

import { DocumentResponseKind } from "./structures/vocabulary.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";

let activeSink: ProgressSink | undefined;

export function setReconstructionProgressSink(sink: ProgressSink | undefined): void {
    activeSink = sink;
}

// Announce one reconstruction step to the active sink (a no-op without one). `current`/`total`
// ride together on counted per-item events, mirroring loadTranscript's ProgressEvent contract.
export function reportReconstructionProgress(label: string, current?: number, total?: number): void {
    if (activeSink === undefined) {
        return;
    }
    if (current === undefined) {
        activeSink({ kind: DocumentResponseKind.progress, label });
        return;
    }
    activeSink({ kind: DocumentResponseKind.progress, label, current, total });
}

