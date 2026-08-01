// S1 source discovery + S2 node mapping + task 199 timeline completion.

import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { getRecordSource, loadTranscript } from "./parse/loadTranscript.ts";
import { listSubagentTranscripts } from "./viewer_api_projects.ts";
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
import { buildLineageEdges, checkEventIsLineageEdge } from "./layered_lineage.ts";
import type { LineageEvidence } from "./layered_lineage.ts";
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

// Returns override paths verbatim, or discovers top-level .jsonl files.
export function discoverJsonlPaths(projectFolder: Path, override: Path[] | undefined): Path[] {
    if (override !== undefined) {
        return override;
    }
    const jsonlNames = readdirSync(projectFolder.toString())
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
    return jsonlNames.map((name) => new Path(join(projectFolder.toString(), name)));
}

// Resolves repo and snapshot roots for layers 2-3.
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

// Index tool_use block ids to their source JsonlRef for evidence tracking.
function indexJsonlRefsByChangeId(records: TranscriptRecord[], sessionFile: Path): Map<string, JsonlRef> {
    const refsByChangeId = new Map<string, JsonlRef>();
    for (const record of records) {
        collectToolUseRefsFromRecord(record, sessionFile, refsByChangeId);
    }
    return refsByChangeId;
}

// Only write and userEdit carry full content at extraction time.
function checkEventCarriesFullContent(event: FileEvent): boolean {
    return event.kind === EventKind.write || event.kind === EventKind.userEdit;
}

// Extracts Edit's originalFile when present (non-null string).
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

// Populates file->session->nodes map; rename/copy events become lineage evidence instead.
function collectSessionNodes(
    records: TranscriptRecord[],
    sessionFile: Path,
    nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>,
    lineageEvidence: LineageEvidence[],
): void {
    const refsByChangeId = indexJsonlRefsByChangeId(records, sessionFile);
    for (const event of extractFileEvents(records)) {
        const evidence = refsByChangeId.get(event.changeId.toString());
        if (evidence === undefined) {
            continue;
        }
        if (checkEventIsLineageEdge(event)) {
            lineageEvidence.push({ event, evidence });
            continue;
        }
        const target = (event as { target?: Path }).target;
        if (target === undefined) {
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

// One session's sorted timeline for an entity, completed with the on-disk end state and presumption gaps (task 199).
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

// A session's own fork-subagent transcripts, if any (task 375/338).
function subagentPathsFor(projectFolder: Path, sessionJsonlPath: Path): Path[] {
    const sessionId = basename(sessionJsonlPath.toString(), ".jsonl");
    return listSubagentTranscripts(projectFolder.toString(), sessionId)
        .map((entry) => new Path(join(projectFolder.toString(), entry.fileName.toString())));
}

// Entry point: loads all sessions and builds the per-file entity graph.
export function loadLayeredProject(projectFolder: Path, overrides: LayeredSourceOverrides): ReconstructionGraph {
    const nodesByFileThenSession = new Map<string, Map<string, TimelineNode[]>>();
    const lineageEvidence: LineageEvidence[] = [];
    for (const jsonlPath of discoverJsonlPaths(projectFolder, overrides.jsonlPaths)) {
        const { records } = loadTranscript(jsonlPath.toString());
        collectSessionNodes(records, jsonlPath, nodesByFileThenSession, lineageEvidence);
        for (const subagentPath of subagentPathsFor(projectFolder, jsonlPath)) {
            const { records: subagentRecords } = loadTranscript(subagentPath.toString());
            collectSessionNodes(subagentRecords, subagentPath, nodesByFileThenSession, lineageEvidence);
        }
    }
    // buildLineageEdges adds an entity for any rename/copy endpoint the node walk never saw.
    const entitiesByPath = new Map(
        buildEntities(nodesByFileThenSession).map((entity) => [entity.filename.toString(), entity]),
    );
    const { renames, copies } = buildLineageEdges(lineageEvidence, entitiesByPath);
    return { entities: [...entitiesByPath.values()], renames, copies, scriptLinks: [] };
}

