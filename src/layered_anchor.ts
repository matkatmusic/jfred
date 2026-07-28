// Layer-1 anchor semantics: first full-content beacon per timeline (spec S2/Q14).

import { getRecordSource } from "./parse/loadTranscript.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import {
    getToolResultForUserRecord,
    indexToolUseNamesById,
    resolveToolNameForRecord,
    type ReadResult,
} from "./structures/tool-results.ts";
import { LayeredNodeKind, ToolName } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import type {
    BeaconNode,
    EndStateNode,
    JsonlRef,
    Timeline,
    TimelineNode,
} from "./layered_types.ts";

// Returns the timeline's first beacon node — its anchor (Q14).
export function selectAnchorNode(timeline: Timeline): BeaconNode | undefined {
    return timeline.nodes.find(
        (node): node is BeaconNode => node.kind === LayeredNodeKind.beacon,
    );
}

// Single source of "which kinds carry bytes" for gap pairing.
export function checkNodeCarriesBytes(node: TimelineNode): node is BeaconNode | EndStateNode {
    if (node.kind === LayeredNodeKind.beacon) {
        return true;
    }
    return node.kind === LayeredNodeKind.endState;
}

// Returns verified bytes; byteless kinds throw (spec S2).
export function requireNodeContent(node: TimelineNode): string {
    if (checkNodeCarriesBytes(node)) {
        return node.content;
    }
    throw new Error(`${node.kind} node refuses byte operations (display/placement only)`);
}

// Whether the echo covers the WHOLE file: from line 1 through every line the file holds.
function checkReadEchoIsComplete(result: ReadResult): boolean {
    if (result.file.startLine === 1) {
        return result.file.numLines === result.file.totalLines;
    }
    return false;
}

// Complete echo becomes beacon; partial window becomes pre-anchor stub.
function buildReadEchoNode(result: ReadResult, instant: Date, evidence: JsonlRef): TimelineNode {
    if (checkReadEchoIsComplete(result)) {
        return { kind: LayeredNodeKind.beacon, instant, content: result.file.content, evidence };
    }
    return { kind: LayeredNodeKind.preAnchorStub, instant, evidence };
}

// One file's Read-echo node placement: which timeline it lands on plus the node itself.
export type ReadEchoPlacement = { target: Path; node: TimelineNode };

// Filter by tool name first to avoid fog-of-war throws from getToolResultForUserRecord.
function buildReadEchoPlacement(
    record: TranscriptRecord,
    nameById: Map<string, string>,
    sessionFile: Path,
): ReadEchoPlacement | undefined {
    if (resolveToolNameForRecord(record, nameById) !== ToolName.Read) {
        return undefined;
    }
    const resolved = getToolResultForUserRecord(record, nameById);
    if (resolved === undefined) {
        return undefined;
    }
    if (resolved.toolName !== ToolName.Read) {
        return undefined;
    }
    const source = getRecordSource(record);
    if (source === undefined) {
        return undefined;
    }
    const instant = record.timestamp;
    if (!(instant instanceof Date)) {
        return undefined;
    }
    const evidence: JsonlRef = { sessionFile, line: source.lineNumber };
    return { target: resolved.result.file.filePath, node: buildReadEchoNode(resolved.result, instant, evidence) };
}

// Collect every Read echo across one session's records as layer-1 node placements.
export function collectReadEchoNodes(records: TranscriptRecord[], sessionFile: Path): ReadEchoPlacement[] {
    const nameById = indexToolUseNamesById(records);
    const placements: ReadEchoPlacement[] = [];
    for (const record of records) {
        const placement = buildReadEchoPlacement(record, nameById, sessionFile);
        if (placement !== undefined) {
            placements.push(placement);
        }
    }
    return placements;
}

