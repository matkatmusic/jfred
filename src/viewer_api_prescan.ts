// GET /api/prescan (task 194): the cheap pre-reconstruction scan behind the webapp's
// reconstruction-mode selection view — every touched file with the instant of its FIRST
// modifying event. Parse-only, no engine build: extraction-level events (Write/Edit/rename/
// copy/append/overwrite/user-edit beacons) are cheap and exact; script touches are attributed
// STATICALLY via the basename-mention channel (the runForTarget cheap channel) and flagged as
// candidates — sandbox replay is the only proof and it is consent-gated and expensive.

import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { listEventPaths } from "./reconstruction_bound.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { resolveJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { requireParam, sendJson } from "./viewer_server_routes.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// One touched file on the wire: the ISO instant of its first modifying event, and whether that
// first event is a statically-attributed script run (a candidate, not replay-proven) rather
// than an exact extraction-level event.
export type PrescanFileEntry = {
    path: string;
    firstEventInstant: string;
    firstEventIsScriptRunCandidate: boolean;
};

type FirstEvent = { instant: Date; scriptRunCandidate: boolean };

function recordFirstExactEvent(event: FileEvent, firstEventByPath: Map<string, FirstEvent>): void {
    for (const path of listEventPaths(event)) {
        if (!firstEventByPath.has(path.toString())) {
            firstEventByPath.set(path.toString(), { instant: event.timestamp, scriptRunCandidate: false });
        }
    }
}

// A run whose code mentions a known file's basename BEFORE that file's current first event
// becomes the file's first-event candidate. Order-independent: any earlier mentioning run
// replaces a later one, so the map converges on the earliest. Files touched ONLY by scripts
// have no extraction-level path to enumerate, so they cannot appear here at all — proving
// them needs replay (layer-10 territory, out of a cheap pre-scan's scope).
function markEarlierScriptMentions(run: ScriptRun, firstEventByPath: Map<string, FirstEvent>): void {
    for (const [pathKey, firstEvent] of firstEventByPath) {
        if (run.timestamp < firstEvent.instant && run.code.includes(basename(pathKey))) {
            firstEventByPath.set(pathKey, { instant: run.timestamp, scriptRunCandidate: true });
        }
    }
}

// Every touched file with its first modifying event, earliest first.
export function computeReconstructionPrescan(records: TranscriptRecord[]): PrescanFileEntry[] {
    const firstEventByPath = new Map<string, FirstEvent>();
    for (const event of extractFileEvents(records)) {
        recordFirstExactEvent(event, firstEventByPath);
    }
    for (const run of findScriptExecutionRuns(records)) {
        markEarlierScriptMentions(run, firstEventByPath);
    }
    return [...firstEventByPath.entries()]
        .sort((left, right) => left[1].instant.getTime() - right[1].instant.getTime())
        .map(([pathKey, firstEvent]) => ({
            path: pathKey,
            firstEventInstant: firstEvent.instant.toISOString(),
            firstEventIsScriptRunCandidate: firstEvent.scriptRunCandidate,
        }));
}

// GET /api/prescan?project=<name>[&jsonl=<file>] — the same resolve/load front half as
// /api/document, then the parse-only scan. No consent gate: nothing executes here.
export function handlePrescanRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");
    applyProjectOverrides(projectName);
    const jsonlPaths = resolveJsonlPaths(projectName, query.get("jsonl"));
    const { records } = loadProjectRecords(jsonlPaths);
    sendJson(response, 200, { files: computeReconstructionPrescan(records) });
}
