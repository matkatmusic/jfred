// loadLayeredProject (task 196, spec S1): source discovery (explicit paths win, otherwise
// discovered from the project folder) and the per-file entity graph built from JSONL rows.
// Layer-1 node semantics (anchor selection, end state, presumption gaps) are S2/tasks 198-199 —
// here a full-content row becomes a BeaconNode and any other file-touching row a
// PreAnchorStubNode; S2 refines that mapping.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getRecordSource, loadTranscript } from "./parse/loadTranscript.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { findFirstRecordCwd } from "./reconstruction_base_commit.ts";
import { resolveFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, EventKind, LayeredNodeKind } from "./structures/vocabulary.ts";
import { compareAxisPlacements, type AxisPlacement } from "./layered_instants.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import type {
    JsonlRef,
    ReconstructionEntity,
    ReconstructionGraph,
    SessionTimeline,
    TimelineNode,
} from "./layered_types.ts";

// The S1 source overrides: any explicitly given path set wins over folder discovery.
export interface LayeredSourceOverrides {
    repoPath?: Path;
    jsonlPaths?: Path[];
    snapshotPaths?: Path[];
}

// The session files to load: the override verbatim, otherwise the folder's top-level .jsonl
// files in name order (session-id subdirectories hold sidecars, not transcripts).
export function discoverJsonlPaths(projectFolder: Path, override: Path[] | undefined): Path[] {
    if (override !== undefined) {
        return override;
    }
    const jsonlNames = readdirSync(projectFolder.toString())
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
    return jsonlNames.map((name) => new Path(join(projectFolder.toString(), name)));
}

// The evidence roots layers 2-3 consume: explicit overrides win; otherwise the repo root is the
// records' first cwd and the snapshot root the transcript-derived file-history resolution chain.
export function resolveEvidenceRoots(
    records: TranscriptRecord[],
    overrides: LayeredSourceOverrides,
): { repoPath: Path | undefined; snapshotPaths: Path[] } {
    const repoPath = overrides.repoPath ?? findFirstRecordCwd(records);
    const snapshotPaths = overrides.snapshotPaths ?? [resolveFileHistoryRoot(records)];
    return { repoPath, snapshotPaths };
}

// Register one record's tool_use block ids under its evidence line.
function collectToolUseRefsFromRecord(
    record: TranscriptRecord,
    sessionFile: Path,
    refsByChangeId: Map<string, JsonlRef>,
): void {
    const source = getRecordSource(record);
    if (source === undefined) {
        return;
    }
    for (const block of getContentBlocks(record)) {
        if (block.type !== BlockType.tool_use) {
            continue;
        }
        refsByChangeId.set(block.id.toString(), { sessionFile, line: source.lineNumber });
    }
}

// Map each tool_use block id to the JsonlRef of the record that issued it, so events (keyed by
// changeId = block id) can point back at their evidence line.
function indexJsonlRefsByChangeId(records: TranscriptRecord[], sessionFile: Path): Map<string, JsonlRef> {
    const refsByChangeId = new Map<string, JsonlRef>();
    for (const record of records) {
        collectToolUseRefsFromRecord(record, sessionFile, refsByChangeId);
    }
    return refsByChangeId;
}

// Whether the event carries full verified content AT EXTRACTION TIME (append/overwrite content
// is filled later during reconstruction, so only write and user-edit qualify here).
function checkEventCarriesFullContent(event: FileEvent): boolean {
    return event.kind === EventKind.write || event.kind === EventKind.userEdit;
}

// The S1 node for one file-touching event: full content -> beacon, anything else -> stub.
// ponytail: S1 places rows on the axis; S2 (tasks 198/199) owns real layer-1 node semantics.
function buildNodeFromEvent(event: FileEvent, evidence: JsonlRef): TimelineNode {
    if (checkEventCarriesFullContent(event)) {
        const content = (event as { content: string }).content;
        return { kind: LayeredNodeKind.beacon, instant: event.timestamp, content, evidence };
    }
    return { kind: LayeredNodeKind.preAnchorStub, instant: event.timestamp, evidence };
}

// Collect one session's nodes into the nested file -> session -> nodes map. Rename/copy events
// carry from/to instead of target — they become typed edges in S6 (task 203), not nodes here.
function collectSessionNodes(
    records: TranscriptRecord[],
    sessionFile: Path,
    nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>,
): void {
    const refsByChangeId = indexJsonlRefsByChangeId(records, sessionFile);
    for (const event of extractFileEvents(records)) {
        const target = (event as { target?: Path }).target;
        if (target === undefined) {
            continue;
        }
        const evidence = refsByChangeId.get(event.changeId.toString());
        if (evidence === undefined) {
            continue;
        }
        const sessionNodeLists = nodesByFileThenSession.get(target.toString()) ?? new Map<string, TimelineNode[]>();
        nodesByFileThenSession.set(target.toString(), sessionNodeLists);
        const nodes = sessionNodeLists.get(sessionFile.toString()) ?? [];
        sessionNodeLists.set(sessionFile.toString(), nodes);
        nodes.push(buildNodeFromEvent(event, evidence));
    }
}

// The sortable axis view of one node (JSONL rows are ms-precision — the widened-seconds flag
// arrives with git beacons in layer 2/task 200).
function makeJsonlAxisPlacement(node: TimelineNode): AxisPlacement {
    return {
        instant: node.instant,
        widenedFromSeconds: false,
        content: node.kind === LayeredNodeKind.beacon ? node.content : undefined,
    };
}

// Sort one timeline's nodes onto the shared instant axis.
function sortNodesOntoAxis(nodes: TimelineNode[]): TimelineNode[] {
    return nodes
        .map((node) => ({ node, placement: makeJsonlAxisPlacement(node) }))
        .sort((a, b) => compareAxisPlacements(a.placement, b.placement))
        .map((entry) => entry.node);
}

// One session's sorted timeline for an entity.
function buildSessionTimeline(sessionFileKey: string, nodes: TimelineNode[]): SessionTimeline {
    return { sessionFile: new Path(sessionFileKey), timeline: { nodes: sortNodesOntoAxis(nodes) } };
}

// One entity per distinct absolute path, its sessionTimelines in session-file name order.
function buildEntities(nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>): ReconstructionEntity[] {
    const entities: ReconstructionEntity[] = [];
    for (const [fileKey, sessionNodeLists] of nodesByFileThenSession) {
        const sessionTimelines = [...sessionNodeLists.entries()]
            .sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile))
            .map(([sessionFileKey, nodes]) => buildSessionTimeline(sessionFileKey, nodes));
        entities.push({ filename: new Path(fileKey), sessionTimelines });
    }
    return entities;
}

// S1 loader entry point: discover sources (explicit paths win), load every session transcript,
// and return the per-file entity graph. Typed edges stay empty until S6 (task 203); the
// evidence roots from resolveEvidenceRoots feed layers 2-3 (tasks 200-202).
export function loadLayeredProject(projectFolder: Path, overrides: LayeredSourceOverrides): ReconstructionGraph {
    const nodesByFileThenSession = new Map<string, Map<string, TimelineNode[]>>();
    for (const jsonlPath of discoverJsonlPaths(projectFolder, overrides.jsonlPaths)) {
        const { records } = loadTranscript(jsonlPath.toString());
        collectSessionNodes(records, jsonlPath, nodesByFileThenSession);
    }
    return { entities: buildEntities(nodesByFileThenSession), renames: [], copies: [], scriptLinks: [] };
}
