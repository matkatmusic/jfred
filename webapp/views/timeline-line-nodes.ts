// Task 134: the "show every JSONL line" toggle — one timeline row per transcript record that is not already a turn or tool-call row (restoring the pre-filter-chips every-line view).  Model + sessionStorage accessors live here, their one canonical home; timeline-types.ts sits at the 250-line cap and only unions the node type in.

import type { WireTimelineDocument } from "./timeline-types.ts";

export const LINE_NODE_KIND = "jsonl-line";
const ALL_LINES_STORAGE_KEY = "timeline:allLines";
const ALL_LINES_ON_VALUE = "1";

// The engine's per-line verdict on the wire (LineVerdict in src/reconstruction_line_verdicts.ts; dates/uuids arrive as plain strings). Optional on the document — older cached documents lack it.
export type WireLineVerdict = {
    line: number;
    uuid?: string;
    type: string;
    verdict: string;
    timestamp?: string;
    sessionId?: string;
    // task 160: the record's transcript file + 1-based line (RecordSource server-side) — absent on pre-task-160 cached documents.
    source?: { filePath: string; lineNumber: number };
};

// One raw-transcript-line row. Mirrors the union convention in timeline-types.ts: every field another node kind carries is declared `?: undefined` so union property access stays legal.
export type LineNode = {
    kind: typeof LINE_NODE_KIND;
    when: string;
    sessionId: string | undefined;
    uuid?: string;
    text: string;
    // task 160: the row's transcript file (basename, the /api/raw jsonl name) and its 0-based raw-line index — the { } button's direct-open coordinates. Accessed only after `kind` narrowing, so the other node kinds need no `?: undefined` mirrors.
    sourceJsonlName: string | undefined;
    sourceLineIndex: number | undefined;
    stepNumber?: undefined;
    isSystem?: undefined;
    isOrphaned?: undefined;
    isGitBaseline?: undefined;
    snapshots?: undefined;
    gitOperations?: undefined;
    fileChanges?: undefined;
    detail?: undefined;
    resultHash?: undefined;
    isError?: undefined;
    summary?: undefined;
    toolName?: undefined;
    toolUseId?: undefined;
    scriptRun?: undefined;
};

// A verdict line gets its own row unless a turn or tool-call row already shows that record.
function checkLineNeedsOwnRow(verdict: WireLineVerdict, representedUuids: Set<string>): boolean {
    if (verdict.uuid === undefined) {
        return true;
    }
    return !representedUuids.has(verdict.uuid);
}

// One node per not-yet-represented transcript line. Timestamp-less records (e.g. summary lines) sort to the top via when="" — where they physically sit in the file.
// ponytail: label resolution downstream is O(rows×lines); precompute a uuid→line map per file
// if toggling large projects drags.
export function deriveLineNodes(document: WireTimelineDocument): LineNode[] {
    const representedUuids = new Set<string>([
        ...document.messages.map((message) => message.uuid),
        ...(document.toolCalls ?? []).map((call) => call.uuid),
    ]);
    return (document.lineVerdicts ?? [])
        .filter((verdict) => checkLineNeedsOwnRow(verdict, representedUuids))
        .map((verdict) => ({
            kind: LINE_NODE_KIND,
            when: verdict.timestamp ?? "",
            sessionId: verdict.sessionId,
            uuid: verdict.uuid,
            text: `${verdict.type} · ${verdict.verdict}`,
            sourceJsonlName: verdict.source === undefined ? undefined : verdict.source.filePath.split("/").pop(),
            // ponytail: lineNumber-1 assumes no interior blank lines in the .jsonl (fetchRawRecords drops blanks); renumber against the raw text if a blank-line transcript ever appears.
            sourceLineIndex: verdict.source === undefined ? undefined : verdict.source.lineNumber - 1,
        }));
}

// The toggle's persisted state (sessionStorage, the task-56 precedent): default off.
export function checkAllLinesIsOn(): boolean {
    return sessionStorage.getItem(ALL_LINES_STORAGE_KEY) === ALL_LINES_ON_VALUE;
}

export function toggleAllLinesSetting(): void {
    if (checkAllLinesIsOn()) {
        sessionStorage.removeItem(ALL_LINES_STORAGE_KEY);
        return;
    }
    sessionStorage.setItem(ALL_LINES_STORAGE_KEY, ALL_LINES_ON_VALUE);
}
