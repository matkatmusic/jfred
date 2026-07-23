// Progress announcements from deep inside the synchronous reconstruction pipeline, streamed to
// the viewer's loading console. Mirrors reconstruction_exec_gate.ts: a build-scoped module-level
// sink set by the viewer around a build and cleared after; undefined otherwise, so the CLI,
// tests, and engine callers stay silent.
// ponytail: process-wide sink, not per-call threading — builds are synchronous and the server
// serializes them; thread an options object through reconstruct* if that changes.

import { DocumentResponseKind } from "./structures/vocabulary.ts";
import type { ProgressEvent, ProgressSink } from "./parse/loadTranscript.ts";

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

// One stderr line for a progress event, or undefined when the event is filtered at this level:
// stage level (--progress) drops the counted per-item events; --progress-all keeps them.
function formatProgressLine(event: ProgressEvent, showCountedEvents: boolean): string | undefined {
    if (event.current === undefined) {
        return `${event.label}\n`;
    }
    if (!showCountedEvents) {
        return undefined;
    }
    return `${event.label} (${event.current}/${event.total})\n`;
}

// Stage-level runs stay silent through slow counted loops (branch-tip scans on real data run
// minutes per item), which reads as a frozen engine. After this much silence, the next counted
// event surfaces even at stage level — a heartbeat, not the --progress-all flood.
const STAGE_HEARTBEAT_MS = 2000;

// task 191: CLI progress goes to stderr so stdout stays pure JSON for --json consumers.
export function buildStderrProgressSink(showCountedEvents: boolean): ProgressSink {
    let lastWriteMs = Date.now();
    return (event) => {
        const heartbeatDue = Date.now() - lastWriteMs >= STAGE_HEARTBEAT_MS;
        const line = formatProgressLine(event, showCountedEvents || heartbeatDue);
        if (line !== undefined) {
            lastWriteMs = Date.now();
            process.stderr.write(line);
        }
    };
}

