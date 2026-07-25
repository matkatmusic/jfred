// Task 203 (spec S6): typed lineage edges and DERIVED lineage. The engine already extracts
// `mv` as an EventKind.rename and `cp` as an EventKind.copy (reconstruction_bash_events.ts,
// reached through extractFileEvents) — those same events become the graph's RenameEdge /
// CopyEdge here, each carrying the JsonlRef of the row that recorded it. Lineage is never
// stored as a group (Q11): `lineageOf` walks the RenameEdges on demand, and a copy's genesis
// bytes are derived from the source's merged timeline at the copy instant.

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

// One lineage event held with the JSONL line that recorded it — the loader collects these while
// walking sessions, because the edges can only be built once every entity exists.
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

// The entity for a path, created empty when the path has no content evidence of its own: a
// rename/copy endpoint still owns a history, and at layer 1 the edge may be all that is known
// about it.
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

// The graph's typed edges, in evidence order. `entitiesByPath` gains an entity for any endpoint
// it does not already hold, so the caller reads its entity set back out of the map.
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

// The rename edges keyed by the path on one side, so a walk can step from an entity to its
// next (or previous) name.
function indexRenamesByEntity(
    renames: RenameEdge[],
    side: (edge: RenameEdge) => ReconstructionEntity,
): Map<string, RenameEdge> {
    return new Map(renames.map((edge) => [side(edge).filename.toString(), edge]));
}

// Follow one direction of the rename graph from `start`, EXCLUDING `start` itself. Stops at a
// name already in `seen` (which both directions of one lineage share): recorded evidence can
// describe a cycle (`mv a b; mv b a`) and a name may appear once per history. The engine's
// resolveFinalPath answers only "the last path", so it cannot give the ordered entity chain a
// lineage is.
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

// One continuous history (spec S6): every entity this file was named, oldest name first,
// derived by walking RenameEdges back to the origin and forward to the final name. A copy is
// NOT a rename, so a forked entity's lineage stays its own.
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

// bornCopy's first content: copiedFrom's reconstructed state at timestampOfCopy — the last
// verified bytes at or before the copy across the source's MERGED timeline (spec S5's derived
// view, so any session's evidence counts). Undefined when no verified state precedes the copy:
// the genesis stays unknown rather than invented (Q8). Derived on demand, never stored on the
// bornCopy timeline.
export function findCopyBornContent(edge: CopyEdge): string | undefined {
    const observed = mergeSessionTimelines(edge.copiedFrom).nodes
        .map((merged) => merged.node)
        .filter(checkNodeCarriesBytes)
        .filter((node) => node.instant.getTime() <= edge.timestampOfCopy.getTime());
    return observed.at(-1)?.content;
}
