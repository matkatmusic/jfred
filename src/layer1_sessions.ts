// Task 311 (spec S19): per-session JSONL metadata and the custom title in effect at a transcript line.

import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { RecordType } from "./structures/vocabulary.ts";
import { loadTranscript, getRecordSource } from "./parse/loadTranscript.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { listEventPaths } from "./reconstruction_bound.ts";

// A session can be renamed part-way through, so its title is a function of position in the file.
export type SessionTitleRange = { fromLine: number; title: string };

// `started`/`ended` are the session's first and last RECORD instants, not the instants of the files it wrote.
export type SessionMetadata = {
    file: Path;
    sessionId: Uuid | undefined;
    started: Date | undefined;
    ended: Date | undefined;
    paths: Path[];
    titles: SessionTitleRange[];
};

// Reduce rather than last-of-filter, so an unsorted list off the wire still resolves correctly.
export function titleInEffectAtLine(titles: SessionTitleRange[], line: number): string | undefined {
    let inEffect: SessionTitleRange | undefined;
    for (const range of titles) {
        if (range.fromLine > line) {
            continue;
        }
        if (inEffect === undefined || range.fromLine > inEffect.fromLine) {
            inEffect = range;
        }
    }
    return inEffect?.title;
}

// File order makes ranges ascending; every range is kept because deduping is the Nav row's job.
function collectTitleRanges(records: TranscriptRecord[]): SessionTitleRange[] {
    const titles: SessionTitleRange[] = [];
    for (const record of records) {
        if (record.type !== RecordType.customTitle) {
            continue;
        }
        const title = record["customTitle"];
        if (typeof title !== "string") {
            continue;
        }
        titles.push({ fromLine: getRecordSource(record)?.lineNumber ?? 0, title });
    }
    return titles;
}

// Min/max rather than first/last, because a transcript's records are not guaranteed monotonic.
function findRecordInstantSpan(records: TranscriptRecord[]): { started?: Date; ended?: Date } {
    let started: Date | undefined;
    let ended: Date | undefined;
    for (const record of records) {
        const timestamp = record.timestamp;
        if (!(timestamp instanceof Date)) {
            continue;
        }
        if (started === undefined || timestamp.getTime() < started.getTime()) {
            started = timestamp;
        }
        if (ended === undefined || timestamp.getTime() > ended.getTime()) {
            ended = timestamp;
        }
    }
    return { started, ended };
}

// listEventPaths already knows a rename/copy contributes both its from and its to.
function collectWrittenPaths(records: TranscriptRecord[]): Path[] {
    const seen = new Set<string>();
    const paths: Path[] = [];
    for (const event of extractFileEvents(records)) {
        for (const path of listEventPaths(event)) {
            const key = path.toString();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            paths.push(path);
        }
    }
    return paths;
}

// Tolerant parsing matches the viewer's loader: a real session with unmodeled fields must still open.
export function buildSessionMetadata(sessionFiles: Path[]): SessionMetadata[] {
    return sessionFiles.map((file) => {
        const records = loadTranscript(file.toString(), undefined, true).records;
        const { started, ended } = findRecordInstantSpan(records);
        return {
            file,
            sessionId: findSessionId(records),
            started,
            ended,
            paths: collectWrittenPaths(records),
            titles: collectTitleRanges(records),
        };
    });
}
