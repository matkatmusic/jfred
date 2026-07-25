// loadLayeredProject (task 196, spec S1): source discovery (explicit paths win, otherwise
// discovered from the project folder) and the per-file entity graph built from JSONL rows.
// Layer-1 node mapping (task 198, spec S2): a full-content row (Write body, user edit, Edit
// with populated originalFile, complete Read echo) becomes a BeaconNode; any other
// file-touching row a PreAnchorStubNode. Each session timeline is then completed (task 199):
// on-disk end state as the final node, presumption gaps between differing verified states.

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
import { sortNodesOntoAxis } from "./layered_instants.ts";
import { collectReadEchoNodes } from "./layered_anchor.ts";
import { completeLayer1Timeline } from "./layered_end_state.ts";
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

// An Edit result's populated originalFile is the literal pre-edit disk — full-content evidence
// (task 198). The wire value may be null (unreported), so populated means a real string.
function findEditOriginalContent(event: FileEvent): string | undefined {
    if (event.kind !== EventKind.edit) {
        return undefined;
    }
    if (typeof event.originalFile === "string") {
        return event.originalFile;
    }
    return undefined;
}

// The layer-1 node for one file-touching event: full content -> beacon, anything else -> stub.
function buildNodeFromEvent(event: FileEvent, evidence: JsonlRef): TimelineNode {
    if (checkEventCarriesFullContent(event)) {
        const content = (event as { content: string }).content;
        return { kind: LayeredNodeKind.beacon, instant: event.timestamp, content, evidence };
    }
    const originalContent = findEditOriginalContent(event);
    if (originalContent !== undefined) {
        return { kind: LayeredNodeKind.beacon, instant: event.timestamp, content: originalContent, evidence };
    }
    return { kind: LayeredNodeKind.preAnchorStub, instant: event.timestamp, evidence };
}

// The (file, session) node list out of the nested map, created on first touch.
function getOrCreateNodeList(
    nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>,
    fileKey: string,
    sessionKey: string,
): TimelineNode[] {
    const sessionNodeLists = nodesByFileThenSession.get(fileKey) ?? new Map<string, TimelineNode[]>();
    nodesByFileThenSession.set(fileKey, sessionNodeLists);
    const nodes = sessionNodeLists.get(sessionKey) ?? [];
    sessionNodeLists.set(sessionKey, nodes);
    return nodes;
}

// Collect one session's nodes into the nested file -> session -> nodes map. Rename/copy events
// carry from/to instead of target — they become typed edges in S6 (task 203), not nodes here.
// Read echoes leave no FileEvent, so their nodes join from collectReadEchoNodes (task 198).
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
        getOrCreateNodeList(nodesByFileThenSession, target.toString(), sessionFile.toString())
            .push(buildNodeFromEvent(event, evidence));
    }
    for (const placement of collectReadEchoNodes(records, sessionFile)) {
        getOrCreateNodeList(nodesByFileThenSession, placement.target.toString(), sessionFile.toString())
            .push(placement.node);
    }
}

// One session's sorted timeline for an entity, completed with the on-disk end state and
// presumption gaps (task 199).
function buildSessionTimeline(sessionFileKey: string, nodes: TimelineNode[], filename: Path): SessionTimeline {
    return {
        sessionFile: new Path(sessionFileKey),
        timeline: { nodes: completeLayer1Timeline(sortNodesOntoAxis(nodes), filename) },
    };
}

// One entity per distinct absolute path, its sessionTimelines in session-file name order.
function buildEntities(nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>): ReconstructionEntity[] {
    const entities: ReconstructionEntity[] = [];
    for (const [fileKey, sessionNodeLists] of nodesByFileThenSession) {
        const sessionTimelines = [...sessionNodeLists.entries()]
            .sort(([leftFile], [rightFile]) => leftFile.localeCompare(rightFile))
            .map(([sessionFileKey, nodes]) => buildSessionTimeline(sessionFileKey, nodes, new Path(fileKey)));
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
