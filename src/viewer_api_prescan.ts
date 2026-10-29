// GET /api/prescan: parse-only scan of every touched file and its first modifying event instant.

import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { listEventPaths } from "./reconstruction_bound.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { findJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { getRequiredParam, sendJson } from "./viewer_server_routes.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// One touched file: ISO instant of its first event, and whether that event is a static script-run candidate.
export type PrescanFileEntry = {
  path: string;
  firstEventInstant: string;
  firstEventIsScriptRunCandidate: boolean;
};

type FirstEvent = { instant: Date; scriptRunCandidate: boolean };

function markFirstExactEvent(event: FileEvent, firstEventByPath: Map<string, FirstEvent>): void {
  for (const path of listEventPaths(event)) {
    const pathKey = path.toString();
    const hasPathKey = firstEventByPath.has(pathKey);
    if (!hasPathKey) {
      firstEventByPath.set(pathKey, { instant: event.timestamp, scriptRunCandidate: false });
    }
  }
}

// An earlier run mentioning a known file's basename becomes that file's first-event candidate.
function markEarlierScriptMentions(run: ScriptRun, firstEventByPath: Map<string, FirstEvent>): void {
  for (const [pathKey, firstEvent] of firstEventByPath) {
    const runIsEarlier = run.timestamp < firstEvent.instant;
    const runMentionsFile = run.code.includes(basename(pathKey));
    const isEarlierMention = runIsEarlier && runMentionsFile;
    if (isEarlierMention) {
      firstEventByPath.set(pathKey, { instant: run.timestamp, scriptRunCandidate: true });
    }
  }
}

function compareFirstEventInstants(left: [string, FirstEvent], right: [string, FirstEvent]): number {
  return left[1].instant.getTime() - right[1].instant.getTime();
}

// Every touched file with its first modifying event, earliest first.
export function computeReconstructionPrescan(records: TranscriptRecord[]): PrescanFileEntry[] {
  const firstEventByPath = new Map<string, FirstEvent>();
  for (const event of extractFileEvents(records)) {
    markFirstExactEvent(event, firstEventByPath);
  }
  for (const run of findScriptExecutionRuns(records)) {
    markEarlierScriptMentions(run, firstEventByPath);
  }
  const sortedEntries = [...firstEventByPath.entries()];
  sortedEntries.sort(compareFirstEventInstants);
  const entries: PrescanFileEntry[] = [];
  for (const [pathKey, firstEvent] of sortedEntries) {
    entries.push({
      path: pathKey,
      firstEventInstant: firstEvent.instant.toISOString(),
      firstEventIsScriptRunCandidate: firstEvent.scriptRunCandidate,
    });
  }
  return entries;
}

// GET /api/prescan?project=<name>[&jsonl=<file>]: same load as /api/document, no consent gate.
export function sendPrescanResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectName = getRequiredParam(query, "project");
  applyProjectOverrides(projectName);
  const jsonlPaths = findJsonlPaths(projectName, query.get("jsonl"));
  const { records } = loadProjectRecords(jsonlPaths);
  sendJson(response, 200, { files: computeReconstructionPrescan(records) });
}
