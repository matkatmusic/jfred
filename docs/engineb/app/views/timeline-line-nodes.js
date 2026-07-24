// Task 134: the "show every JSONL line" toggle — one timeline row per transcript record that
// is not already a turn or tool-call row (restoring the pre-filter-chips every-line view).
// Model + sessionStorage accessors live here, their one canonical home; timeline-types.ts sits
// at the 250-line cap and only unions the node type in.
export const LINE_NODE_KIND = "jsonl-line";
const ALL_LINES_STORAGE_KEY = "timeline:allLines";
const ALL_LINES_ON_VALUE = "1";
// A verdict line gets its own row unless a turn or tool-call row already shows that record.
function checkLineNeedsOwnRow(verdict, representedUuids) {
    if (verdict.uuid === undefined) {
        return true;
    }
    return !representedUuids.has(verdict.uuid);
}
// One node per not-yet-represented transcript line. Timestamp-less records (e.g. summary lines)
// sort to the top via when="" — where they physically sit in the file.
// ponytail: label resolution downstream is O(rows×lines); precompute a uuid→line map per file
// if toggling large projects drags.
export function deriveLineNodes(document) {
    const representedUuids = new Set([
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
        // ponytail: lineNumber-1 assumes no interior blank lines in the .jsonl
        // (fetchRawRecords drops blanks); renumber against the raw text if a
        // blank-line transcript ever appears.
        sourceLineIndex: verdict.source === undefined ? undefined : verdict.source.lineNumber - 1,
    }));
}
// The toggle's persisted state (sessionStorage, the task-56 precedent): default off.
export function checkAllLinesIsOn() {
    return sessionStorage.getItem(ALL_LINES_STORAGE_KEY) === ALL_LINES_ON_VALUE;
}
export function toggleAllLinesSetting() {
    if (checkAllLinesIsOn()) {
        sessionStorage.removeItem(ALL_LINES_STORAGE_KEY);
        return;
    }
    sessionStorage.setItem(ALL_LINES_STORAGE_KEY, ALL_LINES_ON_VALUE);
}
