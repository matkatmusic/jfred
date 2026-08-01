// Track a file across renames into one unified history.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { FileEvent } from "./reconstruction_engine.ts";

// Map each rename source path -> its destination path.
export function buildRenameChain(events: FileEvent[]): Map<string, Path> {
    const next = new Map<string, Path>();
    for (const event of events) {
        if (event.kind === EventKind.rename) {
            next.set(event.from.toString(), event.to);
        }
    }
    return next;
}

// Follows the rename chain; seen-set stops a recorded undo (mv a b; mv b a) from looping forever.
export function resolveFinalPath(
    path: Path,
    renameChain: Map<string, Path>,
): Path {
    let current = path;
    const seen = new Set<string>([current.toString()]);
    while (renameChain.has(current.toString())) {
        const next = renameChain.get(current.toString())!;
        if (seen.has(next.toString())) {
            return current;
        }
        seen.add(next.toString());
        current = next;
    }
    return current;
}

// The path a content event touches; for a rename or copy it is the destination.
export function contentPathOf(event: FileEvent): Path {
    if (event.kind === EventKind.rename) {
        return event.to;
    }
    if (event.kind === EventKind.copy) {
        return event.to;
    }
    return event.target;
}

// Whether an event belongs to the lineage that ends at finalTarget.
export function eventBelongsToLineage(
    event: FileEvent,
    finalTarget: Path,
    renameChain: Map<string, Path>,
): boolean {
    return resolveFinalPath(contentPathOf(event), renameChain).equals(finalTarget);
}

// Unique lineage keys: rename sources collapse to their final destination.
export function distinctFinalPaths(
    events: FileEvent[],
    renameChain: Map<string, Path>,
): Path[] {
    const byPath = new Map<string, Path>();
    for (const event of events) {
        const finalPath = resolveFinalPath(contentPathOf(event), renameChain);
        byPath.set(finalPath.toString(), finalPath);
    }
    return [...byPath.values()];
}

