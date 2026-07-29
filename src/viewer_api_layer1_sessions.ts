// GET /api/layer1-sessions — one summary row per transcript under the picked JSONL folders (task 292).
//
// Every failure is a SKIP, never a throw: one corrupt transcript must not blank the whole list.

import { existsSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { readFirstUserPrompt } from "./reconstruction_prompts.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import { SourceKind } from "./structures/vocabulary_view.ts";
import { streamNdjsonBuild } from "./viewer_api_layer1_route.ts";
import { listSourceFilesUnder } from "./viewer_api_layer1_sources.ts";
import { computeReconstructionPrescan } from "./viewer_api_prescan.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { sendJson } from "./viewer_server_routes.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// A title is one line in a narrow pane — the mockup's width holds ~70 characters.
const SESSION_TITLE_LIMIT = 70;

// Named so tests assert the same string the stream emits (task 304).
export const LAYER1_SESSIONS_PROGRESS_LABEL_SCANNING = "scanning JSONL files";

export interface Layer1WireSession {
    file: string;       // basename, e.g. "0f3c9a7e.jsonl"
    fullPath: string;   // absolute path — the wire identity the pane de-duplicates and selects on
    title: string;      // first user prompt, trimmed and truncated; "" when the session has none
    started: string;    // ISO instant of the FIRST record
    ended: string;      // ISO instant of the LAST record
    paths: string[];    // every file path the session touched
}

// The window a range bar spans; a transcript with no timestamps has no axis place — undefined drops it.
function measureSessionWindow(records: TranscriptRecord[]): { started: Date; ended: Date } | undefined {
    const times = records.flatMap((record) => record.timestamp === undefined ? [] : [record.timestamp.getTime()]);
    if (times.length === 0) {
        return undefined;
    }
    // reduce, not Math.min(...times): a long session's record count would blow the argument limit.
    return {
        started: new Date(times.reduce((earliest, time) => Math.min(earliest, time))),
        ended: new Date(times.reduce((latest, time) => Math.max(latest, time))),
    };
}

// One row, or undefined when the file yields nothing placeable — including on any parse throw.
function summarizeSession(jsonlPath: Path): Layer1WireSession | undefined {
    try {
        const { records } = loadProjectRecords([jsonlPath]);
        const window = measureSessionWindow(records);
        if (window === undefined) {
            return undefined;
        }
        return {
            file: basename(jsonlPath.toString()),
            fullPath: jsonlPath.toString(),
            title: readFirstUserPrompt(records).trim().slice(0, SESSION_TITLE_LIMIT),
            started: window.started.toISOString(),
            ended: window.ended.toISOString(),
            // The prescan is the one canonical "which files did this session touch" — never re-derived.
            paths: computeReconstructionPrescan(records).map((entry) => entry.path),
        };
    } catch {
        return undefined;
    }
}

// Every transcript under every picked folder, de-duplicated by absolute path (two folders may nest or repeat).
function listTranscriptFiles(folders: readonly string[]): Path[] {
    const byPath = new Map<string, Path>();
    for (const folder of folders) {
        // A DERIVED default source folder need not exist yet: empty pane, not a bad request.
        if (!existsSync(folder)) {
            continue;
        }
        for (const jsonlPath of listSourceFilesUnder(new Path(folder), SourceKind.jsonl)) {
            byPath.set(jsonlPath.toString(), jsonlPath);
        }
    }
    return [...byPath.values()];
}

// Ordered by start instant (ISO string compare IS chronological); the slow per-file parse is the counted unit (task 304).
export function buildLayer1Sessions(folders: readonly string[], reportProgress: ProgressSink = () => {}): Layer1WireSession[] {
    const files = listTranscriptFiles(folders);
    const sessions: Layer1WireSession[] = [];
    files.forEach((jsonlPath, index) => {
        reportProgress({
            kind: DocumentResponseKind.progress,
            label: LAYER1_SESSIONS_PROGRESS_LABEL_SCANNING,
            current: index + 1,
            total: files.length,
        });
        const session = summarizeSession(jsonlPath);
        if (session !== undefined) {
            sessions.push(session);
        }
    });
    return sessions.sort((left, right) => left.started.localeCompare(right.started));
}

// `jsonl` repeats per folder; zero is a 400. `progress=1` streams NDJSON exactly like /api/layer1-view.
export function handleLayer1SessionsRequest(response: ServerResponse, query: URLSearchParams): void {
    const folders = query.getAll("jsonl");
    if (folders.length === 0) {
        throw new Error("missing query param: jsonl");
    }
    if (query.get("progress") !== "1") {
        sendJson(response, 200, { sessions: buildLayer1Sessions(folders) });
        return;
    }
    streamNdjsonBuild(response, (writeNdjsonLine) => ({ sessions: buildLayer1Sessions(folders, writeNdjsonLine) }));
}
