// File-history view model (DOM-free): wire shapes, revision-text rendering, revision anchoring,
// changeId lookup, and per-revision diff block slicing. Tested against scenario ground truth
// (viewer-file-history.test.ts). task 93: the DOM half (file-history.ts) is retired to
// webapp/archive/ — the Revision View (details-revision-view.ts) is this model's consumer now.

// Wire shapes (JSON off the server: ids/paths/dates are plain strings), minimal to this file's use.
type WireRename = { from: string; to: string };
// A revision carries its own per-line model (the engine's LineEntry.values); the last value of each
// line is that line's believed text at this revision (mirrors the server's linesTextOf).
type WireLineEntry = { values: { line: string }[] };
type WireRevision = { kind: string; changeId: string; timestamp: string; rename?: WireRename; lines?: WireLineEntry[] };
type WireFileHistory = { target: string; revisions: WireRevision[] };
// The minimal shape the changeId lookup helpers read — callers (inspector.ts, tests) pass
// structurally smaller histories than the full view model; WireFileHistory satisfies it.
export type WireRevisionRef = { changeId: string; timestamp?: string };
export type WireFileHistoryRef = { target: string; revisions: WireRevisionRef[] };
export type WireDocument = { filesTouched: WireFileHistory[] };

// A revision's believed text: the last value of each line, newline-joined — the same rendering the
// server's renderRevisionText/linesTextOf produce. Derived from the revision's OWN lines (already on
// the wire), so no per-step file snapshot is needed (the >512 MB wire-size fix).
function renderRevisionText(revision: WireRevision): string {
    return (revision.lines ?? []).map((entry) => entry.values[entry.values.length - 1]!.line).join("\n");
}

// Build the view model: { path, revisions: [{ kind, changeId, timestamp, content, rename }] },
// oldest first (the document's own revision order). Unknown path -> empty revisions, never a throw.
export function buildFileHistoryViewModel(document: WireDocument, path: string) {
    const history = document.filesTouched.find((entry) => entry.target === path);
    if (history === undefined) {
        return { path, revisions: [] };
    }
    const revisions = history.revisions.map((revision) => ({
        kind: revision.kind,
        changeId: revision.changeId,
        timestamp: revision.timestamp,
        content: renderRevisionText(revision),
        rename: revision.rename,
    }));
    return { path, revisions };
}

// The 0-based revision index named by a route's 1-based /rev/<n> segment, or undefined when the
// segment is absent, not an integer, or out of range for the revision list.
export function computeAnchoredRevisionIndex(anchorRev: string | undefined, revisionCount: number): number | undefined {
    const revisionIndex = Number(anchorRev) - 1;
    if (!Number.isInteger(revisionIndex)) {
        return undefined;
    }
    if (revisionIndex < 0) {
        return undefined;
    }
    if (revisionIndex >= revisionCount) {
        return undefined;
    }
    return revisionIndex;
}

// changeId -> 0-based raw JSONL line index: the first line whose text contains the changeId.
// A document's changeIds are tool_use ids ("toolu_…") or backup blob names ("…@vN") — each
// appears verbatim in exactly the raw line that caused the revision. (The plan expected
// lineVerdicts uuid matches; in reality changeIds are not record uuids.)
// ponytail: linear substring scan per changeId; fine at transcript scale (hundreds of lines).
export function findLineForChangeId(rawLines: string[], changeId: string): number {
    return rawLines.findIndex((line) => line.includes(changeId));
}

// The 1-based number of the last revision at or before `timestamp` (ISO strings compare
// correctly), or undefined when the timestamp is absent or precedes every revision.
function computeRevisionNumberAtTime(revisions: WireRevisionRef[], timestamp: string | undefined): number | undefined {
    if (timestamp === undefined) {
        return undefined;
    }
    let revisionNumber: number | undefined;
    revisions.forEach((revision, index) => {
        // A Ref without a timestamp never matches (same as the untyped `undefined <= t` → false).
        if (revision.timestamp !== undefined && revision.timestamp <= timestamp) {
            revisionNumber = index + 1;
        }
    });
    return revisionNumber;
}

// A backup blob name (`<hex>@vN`) — the changeId shape a File History Snapshot stamps on a
// revision. The capture group is the per-file prefix findRevisionForChangeId's fallback keys on.
const BACKUP_BLOB_CHANGE_ID = /^(.+@)v\d+$/;

// True when the changeId names a File History Snapshot blob — the snapshot-backed signal the
// timeline's 📷 jump button keys on (task 94): tool-evidenced revisions (`toolu_…` ids) have no
// snapshot to jump to.
export function checkChangeIdIsBackupBlobName(changeId: string): boolean {
    return BACKUP_BLOB_CHANGE_ID.test(changeId);
}

// The file target and 1-based revision number of the revision whose changeId equals `changeId`
// (toolu id or backup blob name), or undefined when no surviving history carries it. The number
// feeds the /rev/<n> route, whose view anchors that revision. A backup blob name whose exact
// version matches no revision still names its FILE (the hex before @v is per-file): those
// resolve to the revision in effect at `backupTime` (the state that backup captured), or to
// { target, revisionNumber: undefined } — a file-history link with nothing anchored — without one.
export function findRevisionForChangeId(filesTouched: WireFileHistoryRef[], changeId: string, backupTime?: string) {
    for (const history of filesTouched) {
        const index = history.revisions.findIndex((revision) => revision.changeId === changeId);
        if (index >= 0) {
            return { target: history.target, revisionNumber: index + 1 };
        }
    }
    const blobMatch = BACKUP_BLOB_CHANGE_ID.exec(changeId);
    if (blobMatch === null) {
        return undefined;
    }
    for (const history of filesTouched) {
        if (history.revisions.some((revision) => revision.changeId.startsWith(blobMatch[1]!))) {
            return { target: history.target, revisionNumber: computeRevisionNumberAtTime(history.revisions, backupTime) };
        }
    }
    return undefined;
}

// A revision-KIND header ("@@ changed @ … @@", "@@ renamed … @@", …) starts a new block; the
// standard numeric hunk headers ("@@ -a,b +c,d @@") the context renderer emits INSIDE a
// revision must not.
function startsRevisionBlock(line: string): boolean {
    if (line.startsWith("@@")) {
        if (!line.startsWith("@@ -")) {
            return true;
        }
    }
    return false;
}

// Slice the revision-timeline diff text into per-revision blocks (renderDiffWithContext emits
// one block per revision, each starting with its kind header line).
export function splitDiffBlocks(diffText: string): string[] {
    const blocks: string[] = [];
    let current: string[] | null = null;
    for (const line of diffText.split("\n")) {
        if (startsRevisionBlock(line)) {
            if (current !== null) blocks.push(current.join("\n"));
            current = [line];
        } else if (current !== null) {
            current.push(line);
        }
    }
    if (current !== null) blocks.push(current.join("\n"));
    return blocks;
}
