// Task 203 (spec S6): rename/copy events become typed lineage edges; lineageOf walks on demand (Q11).

import { EventKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import { checkNodeCarriesBytes } from "./layered_anchor.ts";
import { mergeSessionTimelines } from "./layered_merge.ts";
import type { CopyEvent, FileEvent, RenameEvent } from "./reconstruction_engine.ts";
import type {
    CopyEdge,
    JsonlRef,
    ReconstructionEntity,
    RenameEdge,
} from "./layered_types.ts";

// The two extracted events that connect two paths, so they become edges instead of nodes.
export type LineageEvent = RenameEvent | CopyEvent;

// Pairs a lineage event with its JSONL source; edges are built after all entities exist.
export interface LineageEvidence {
    event: LineageEvent;
    evidence: JsonlRef;
}

// Whether this extracted event connects two paths (from/to) rather than touching one target.
export function checkEventIsLineageEdge(event: FileEvent): event is LineageEvent {
    if (event.kind === EventKind.rename) {
        return true;
    }
    return event.kind === EventKind.copy;
}

// Returns or creates an empty entity so rename/copy endpoints exist even without content evidence.
function findOrCreateEntity(
    entitiesByPath: Map<string, ReconstructionEntity>,
    path: Path,
): ReconstructionEntity {
    const existing = entitiesByPath.get(path.toString());
    if (existing !== undefined) {
        return existing;
    }
    const created: ReconstructionEntity = { filename: path, sessionTimelines: [] };
    entitiesByPath.set(path.toString(), created);
    return created;
}

// Builds typed rename/copy edges in evidence order, creating missing endpoint entities in the map.
export function buildLineageEdges(
    lineageEvidence: LineageEvidence[],
    entitiesByPath: Map<string, ReconstructionEntity>,
): { renames: RenameEdge[]; copies: CopyEdge[] } {
    const renames: RenameEdge[] = [];
    const copies: CopyEdge[] = [];
    for (const { event, evidence } of lineageEvidence) {
        const from = findOrCreateEntity(entitiesByPath, event.from);
        const to = findOrCreateEntity(entitiesByPath, event.to);
        if (event.kind === EventKind.rename) {
            renames.push({ renamedFrom: from, renamedTo: to, timestampOfRename: event.timestamp, evidence });
            continue;
        }
        copies.push({ copiedFrom: from, bornCopy: to, timestampOfCopy: event.timestamp, evidence });
    }
    return { renames, copies };
}

// Indexes rename edges by one side's path for directional traversal.
function indexRenamesByEntity(
    renames: RenameEdge[],
    side: (edge: RenameEdge) => ReconstructionEntity,
): Map<string, RenameEdge> {
    return new Map(renames.map((edge) => [side(edge).filename.toString(), edge]));
}

// Walks rename edges in one direction from start, stopping at cycles tracked via shared `seen` set.
function walkRenameEdges(
    start: ReconstructionEntity,
    edgesByEntity: Map<string, RenameEdge>,
    step: (edge: RenameEdge) => ReconstructionEntity,
    seen: Set<string>,
): ReconstructionEntity[] {
    const walked: ReconstructionEntity[] = [];
    let current = start;
    let edge = edgesByEntity.get(current.filename.toString());
    while (edge !== undefined) {
        current = step(edge);
        if (seen.has(current.filename.toString())) {
            break;
        }
        seen.add(current.filename.toString());
        walked.push(current);
        edge = edgesByEntity.get(current.filename.toString());
    }
    return walked;
}

// Spec S6: returns the full rename chain oldest-first; copies are separate lineages.
export function lineageOf(
    entity: ReconstructionEntity,
    renames: RenameEdge[],
): ReconstructionEntity[] {
    const seen = new Set([entity.filename.toString()]);
    const earlierNames = walkRenameEdges(
        entity,
        indexRenamesByEntity(renames, (edge) => edge.renamedTo),
        (edge) => edge.renamedFrom,
        seen,
    );
    const laterNames = walkRenameEdges(
        entity,
        indexRenamesByEntity(renames, (edge) => edge.renamedFrom),
        (edge) => edge.renamedTo,
        seen,
    );
    return [...earlierNames.reverse(), entity, ...laterNames];
}

// Derives copy genesis from source's merged timeline at copy instant; undefined if no prior state (Q8).
export function findCopyBornContent(edge: CopyEdge): string | undefined {
    const observed = mergeSessionTimelines(edge.copiedFrom).nodes
        .map((merged) => merged.node)
        .filter(checkNodeCarriesBytes)
        .filter((node) => node.instant.getTime() <= edge.timestampOfCopy.getTime());
    return observed.at(-1)?.content;
}

