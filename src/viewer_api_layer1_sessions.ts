// GET /api/layer1-sessions?jsonl=<folder>&jsonl=<folder> — one summary row per transcript found under the picked JSONL source folders, which is what fills Layer 1's JSONLs pane and places its range bars (task 292).
//
// Every failure here is a SKIP, never a throw: the pane is an accessory to the timeline, so one corrupt transcript must not blank the whole list.

import { existsSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { basename } from "node:path";
import { readFirstUserPrompt } from "./reconstruction_prompts.ts";
import { Path } from "./structures/domain.ts";
import { SourceKind } from "./structures/vocabulary_view.ts";
import { listSourceFilesUnder } from "./viewer_api_layer1_sources.ts";
import { computeReconstructionPrescan } from "./viewer_api_prescan.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { sendJson } from "./viewer_server_routes.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";

// A title is one line in a narrow pane — the mockup's width holds ~70 characters.
const SESSION_TITLE_LIMIT = 70;

export interface Layer1WireSession {
    file: string;       // basename, e.g. "0f3c9a7e.jsonl"
    fullPath: string;   // absolute path — the wire identity the pane de-duplicates and selects on
    title: string;      // first user prompt, trimmed and truncated; "" when the session has none
    started: string;    // ISO instant of the FIRST record
    ended: string;      // ISO instant of the LAST record
    paths: string[];    // every file path the session touched
}

// The window a session's range bar spans. Session-meta lines carry no timestamp, so a transcript with none at all has no place on the axis — undefined drops it from the pane.
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

// One row, or undefined when the file yields nothing placeable — including when loading or scanning throws on a record shape the parser has never seen.
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

// Every session under every picked folder, de-duplicated by absolute path (two folders may nest or repeat) and ordered by start instant. toISOString is fixed-width UTC, so a string compare IS the chronological one.
export function buildLayer1Sessions(folders: readonly string[]): Layer1WireSession[] {
    const sessionsByPath = new Map<string, Layer1WireSession>();
    for (const folder of folders) {
        // A DERIVED default source folder (~/.claude/projects/<mangled dir>) need not exist yet: that is an empty pane for a project with no sessions, not a bad request.
        if (!existsSync(folder)) {
            continue;
        }
        for (const jsonlPath of listSourceFilesUnder(new Path(folder), SourceKind.jsonl)) {
            if (sessionsByPath.has(jsonlPath.toString())) {
                continue;
            }
            const session = summarizeSession(jsonlPath);
            if (session !== undefined) {
                sessionsByPath.set(jsonlPath.toString(), session);
            }
        }
    }
    return [...sessionsByPath.values()].sort((left, right) => left.started.localeCompare(right.started));
}

// `jsonl` is REPEATABLE — one value per picked source folder. Zero is a 400: an empty pane and "the client forgot to say which folders" must not look the same to the page.
export function handleLayer1SessionsRequest(response: ServerResponse, query: URLSearchParams): void {
    const folders = query.getAll("jsonl");
    if (folders.length === 0) {
        throw new Error("missing query param: jsonl");
    }
    sendJson(response, 200, { sessions: buildLayer1Sessions(folders) });
}
