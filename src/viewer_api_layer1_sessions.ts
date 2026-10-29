// GET /api/layer1-sessions: one summary row per transcript; a corrupt transcript is skipped.

import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { collectTitleRanges } from "./layer1_sessions.ts";
import { readFirstUserPrompt } from "./reconstruction_prompts.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { sendNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { listTranscriptFiles } from "./viewer_api_layer1_sources.ts";
import { computeReconstructionPrescan } from "./viewer_api_prescan.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { sendJson } from "./viewer_server_routes.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { WireSession } from "../webapp/layer1-wire.ts";

// A title is one line in a narrow pane — the mockup's width holds ~70 characters.
const SESSION_TITLE_LIMIT = 70;

// Named so tests assert the same string the stream emits (task 304).
export const LAYER1_SESSIONS_PROGRESS_LABEL_SCANNING = "scanning JSONL files";

// The window a range bar spans; a transcript with no timestamps has no axis place — undefined drops it.
function measureSessionWindow(records: TranscriptRecord[]): { started: Date; ended: Date } | undefined {
  let earliest = Infinity;
  let latest = -Infinity;
  // A loop, not Math.min(...times): a long session's record count would blow the argument limit.
  for (const record of records) {
    if (record.timestamp === undefined) {
      continue;
    }
    const time = record.timestamp.getTime();
    earliest = Math.min(earliest, time);
    latest = Math.max(latest, time);
  }
  if (earliest === Infinity) {
    return undefined;
  }
  return { started: new Date(earliest), ended: new Date(latest) };
}

// One row, or undefined when the file yields nothing placeable — including on any parse throw.
function buildSessionSummary(jsonlPath: Path): WireSession | undefined {
  try {
    const { records } = loadProjectRecords([jsonlPath]);
    const window = measureSessionWindow(records);
    if (window === undefined) {
      return undefined;
    }
    const titles: string[] = [];
    for (const range of collectTitleRanges(records)) {
      titles.push(range.title);
    }
    const firstPrompt = readFirstUserPrompt(records);
    // The prescan is the one canonical "which files did this session touch" — never re-derived.
    const paths: string[] = [];
    for (const entry of computeReconstructionPrescan(records)) {
      paths.push(entry.path);
    }
    return {
      file: basename(jsonlPath.toString()),
      fullPath: jsonlPath.toString(),
      titles: titles.length > 0 ? titles : [firstPrompt.trim().slice(0, SESSION_TITLE_LIMIT)],
      started: window.started.toISOString(),
      ended: window.ended.toISOString(),
      paths,
    };
  }
  catch {
    return undefined;
  }
}

function compareSessionStarts(left: WireSession, right: WireSession): number {
  return left.started.localeCompare(right.started);
}

// Ordered by start instant (ISO string compare IS chronological); the slow per-file parse is the counted unit (task 304).
export function buildLayer1Sessions(folders: readonly string[], reportProgress: ProgressSink = () => {}): WireSession[] {
  const files = listTranscriptFiles(folders);
  const sessions: WireSession[] = [];
  for (const [index, jsonlPath] of files.entries()) {
    reportProgress({
      kind: DocumentResponseKind.progress,
      label: LAYER1_SESSIONS_PROGRESS_LABEL_SCANNING,
      current: index + 1,
      total: files.length,
    });
    const session = buildSessionSummary(jsonlPath);
    if (session !== undefined) {
      sessions.push(session);
    }
  }
  return sessions.sort(compareSessionStarts);
}

// `jsonl` repeats per folder; zero is a 400. `progress=1` streams NDJSON exactly like /api/layer1-view.
export function sendLayer1SessionsResponse(response: ServerResponse, query: URLSearchParams): void {
  const folders = query.getAll("jsonl");
  if (folders.length === 0) {
    throw new Error("missing query param: jsonl");
  }
  const progressParam = query.get("progress");
  if (progressParam !== "1") {
    sendJson(response, 200, { sessions: buildLayer1Sessions(folders) });
    return;
  }
  function buildProgressBody(writeNdjsonLine: ProgressSink): { sessions: WireSession[] } {
    return { sessions: buildLayer1Sessions(folders, writeNdjsonLine) };
  }
  sendNdjsonBuild(response, buildProgressBody);
}
