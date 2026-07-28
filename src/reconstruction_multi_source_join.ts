// §a cross-source identity join: content-agreement gate and clone-on-write path remap.

import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";
import { getRecordSource, setRecordSource } from "./parse/loadTranscript.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { checkJoinContentAgreement, noteJoinedPathConflicts } from "./reconstruction_multi_source_gate.ts";

// Extract sessionId from envelope; lives here to keep module imports one-way.
export function sessionIdOf(record: TranscriptRecord): Uuid | undefined {
    return (record as { sessionId?: Uuid }).sessionId;
}

// Recursive COW walk replacing `from` with `to`; never mutates cached input records.
// ponytail: string-replace also rewrites the path where it appears inside file CONTENT strings;
// acceptable for path-space coherence, revisit if a ground truth ever embeds a root path in
// content it wants preserved verbatim.
function cloneValueReplacingPath(value: unknown, from: string, to: string): unknown {
    if (typeof value === "string") {
        return value.split(from).join(to);
    }
    if (value instanceof Path) {
        const replaced = value.toString().split(from).join(to);
        return replaced === value.toString() ? value : new Path(replaced);
    }
    if (value instanceof Date || value instanceof Uuid) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => cloneValueReplacingPath(entry, from, to));
    }
    if (value !== null && typeof value === "object") {
        const cloned: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            cloned[key] = cloneValueReplacingPath(entry, from, to);
        }
        return cloned;
    }
    return value;
}

// Clone record rewriting fromPath to toPath, preserving transcript source stamp.
export function cloneRecordReplacingPath(record: TranscriptRecord, fromPath: Path, toPath: Path): TranscriptRecord {
    const clone = cloneValueReplacingPath(record, fromPath.toString(), toPath.toString()) as TranscriptRecord;
    const source = getRecordSource(record);
    if (source !== undefined) {
        setRecordSource(clone, source);
    }
    return clone;
}

// Every path one event references (rename/copy carry from/to instead of a target).
function pathsOfEvent(event: FileEvent): Path[] {
    if ("target" in event) {
        return [event.target];
    }
    return [event.from, event.to];
}

// The records whose session resolved to the given root.
function filterRecordsByRoot(
    records: TranscriptRecord[],
    sessionRoots: Map<string, Path>,
    root: string,
): TranscriptRecord[] {
    return records.filter((record) => {
        const sessionId = sessionIdOf(record);
        return sessionId !== undefined && sessionRoots.get(sessionId.toString())?.toString() === root;
    });
}

// relPath -> absolutePath (first seen) for every event path under the given root.
function collectRelativePathMap(records: TranscriptRecord[], root: string): Map<string, string> {
    const relativeToAbsolute = new Map<string, string>();
    const eventPaths = extractFileEvents(records).flatMap(pathsOfEvent);
    for (const eventPath of eventPaths) {
        const absolute = eventPath.toString();
        if (!absolute.startsWith(root + "/")) {
            continue;
        }
        const relative = absolute.slice(root.length + 1);
        if (!relativeToAbsolute.has(relative)) {
            relativeToAbsolute.set(relative, absolute);
        }
    }
    return relativeToAbsolute;
}

// The first event in the (time-ordered) records referencing the absolute path — the joining source's §a content evidence.
function findFirstEventForPath(records: TranscriptRecord[], absolutePath: string): FileEvent | undefined {
    return extractFileEvents(records).find((event) =>
        pathsOfEvent(event).some((eventPath) => eventPath.toString() === absolutePath));
}

// Session roots in first-appearance order; earliest root owns each rel-path.
function computeRootOrder(records: TranscriptRecord[], sessionRoots: Map<string, Path>): string[] {
    const rootOrder: string[] = [];
    for (const record of records) {
        const sessionId = sessionIdOf(record);
        const root = sessionId === undefined ? undefined : sessionRoots.get(sessionId.toString());
        if (root !== undefined && !rootOrder.includes(root.toString())) {
            rootOrder.push(root.toString());
        }
    }
    return rootOrder;
}

// rel-path -> primary absolute path across every root earlier than laterIndex, earliest owner winning.
function collectPrimaryPaths(
    records: TranscriptRecord[],
    sessionRoots: Map<string, Path>,
    rootOrder: string[],
    laterIndex: number,
): Map<string, { absolute: string; root: string }> {
    const primaryPaths = new Map<string, { absolute: string; root: string }>();
    for (const earlierRoot of rootOrder.slice(0, laterIndex)) {
        const earlierMap = collectRelativePathMap(filterRecordsByRoot(records, sessionRoots, earlierRoot), earlierRoot);
        addMissingPrimaryEntries(primaryPaths, earlierMap, earlierRoot);
    }
    return primaryPaths;
}

// Merge one root's rel-path map into the primary map, earlier owners keeping their claim.
function addMissingPrimaryEntries(
    primaryPaths: Map<string, { absolute: string; root: string }>,
    relativeToAbsolute: Map<string, string>,
    root: string,
): void {
    for (const [relative, absolute] of relativeToAbsolute) {
        if (!primaryPaths.has(relative)) {
            primaryPaths.set(relative, { absolute, root });
        }
    }
}

// Clone-remap every record of the later root's sessions from one absolute path onto the primary.
function remapLaterRootRecords(
    records: TranscriptRecord[],
    sessionRoots: Map<string, Path>,
    laterRoot: string,
    fromPath: Path,
    toPath: Path,
): TranscriptRecord[] {
    return records.map((record) => {
        const sessionId = sessionIdOf(record);
        const isLaterRootRecord =
            sessionId !== undefined && sessionRoots.get(sessionId.toString())?.toString() === laterRoot;
        return isLaterRootRecord ? cloneRecordReplacingPath(record, fromPath, toPath) : record;
    });
}

// Gate later root's evidence against primary, remap on agreement.
function tryJoinRelativePath(
    workingRecords: TranscriptRecord[],
    sources: SourceEntry[],
    sessionRoots: Map<string, Path>,
    laterRoot: string,
    laterAbsolute: string,
    primary: { absolute: string; root: string },
): TranscriptRecord[] {
    const laterRecords = filterRecordsByRoot(workingRecords, sessionRoots, laterRoot);
    const evidence = findFirstEventForPath(laterRecords, laterAbsolute);
    if (evidence === undefined) {
        return workingRecords;
    }
    const earlierRecords = filterRecordsByRoot(workingRecords, sessionRoots, primary.root);
    if (!checkJoinContentAgreement(earlierRecords, new Path(primary.absolute), evidence, sources)) {
        return workingRecords;
    }
    return remapLaterRootRecords(
        workingRecords, sessionRoots, laterRoot, new Path(laterAbsolute), new Path(primary.absolute));
}

// §a — join same-rel-path files across roots when content evidence agrees.
export function joinCrossSourceFileIdentities(
    records: TranscriptRecord[],
    sources: SourceEntry[],
    sessionRoots: Map<string, Path>,
): TranscriptRecord[] {
    const rootOrder = computeRootOrder(records, sessionRoots);
    if (rootOrder.length <= 1) {
        return records;
    }
    let workingRecords = records;
    const joinedPrimaries = new Set<string>();
    for (let laterIndex = 1; laterIndex < rootOrder.length; laterIndex++) {
        workingRecords = joinPathsOfLaterRoot(
            workingRecords, sources, sessionRoots, rootOrder, laterIndex, joinedPrimaries);
    }
    for (const primaryAbsolute of joinedPrimaries) {
        noteJoinedPathConflicts(workingRecords, new Path(primaryAbsolute), sources);
    }
    return workingRecords;
}

// Join every rel-path the later root shares with an earlier root.
function joinPathsOfLaterRoot(
    workingRecords: TranscriptRecord[],
    sources: SourceEntry[],
    sessionRoots: Map<string, Path>,
    rootOrder: string[],
    laterIndex: number,
    joinedPrimaries: Set<string>,
): TranscriptRecord[] {
    const laterRoot = rootOrder[laterIndex]!;
    const laterPathMap = collectRelativePathMap(
        filterRecordsByRoot(workingRecords, sessionRoots, laterRoot), laterRoot);
    const primaryPaths = collectPrimaryPaths(workingRecords, sessionRoots, rootOrder, laterIndex);
    for (const [relative, laterAbsolute] of laterPathMap) {
        const primary = primaryPaths.get(relative);
        if (primary === undefined || primary.absolute === laterAbsolute) {
            continue;
        }
        const joinedRecords = tryJoinRelativePath(
            workingRecords, sources, sessionRoots, laterRoot, laterAbsolute, primary);
        // remap always builds a new array, so a changed reference marks a completed join.
        if (joinedRecords !== workingRecords) {
            joinedPrimaries.add(primary.absolute);
        }
        workingRecords = joinedRecords;
    }
    return workingRecords;
}
