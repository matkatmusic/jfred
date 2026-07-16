// Lineage: follow a file across renames so one history spans the path change.
// A renamed file is ONE history keyed by its final (surviving) path; a content
// event and the rename that moves it collapse into that single lineage. The
// event/revision model lives in reconstruction_engine.ts. Design: that file.

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

// Follow the rename chain to the path the file ends life at.
export function resolveFinalPath(
    path: Path,
    renameChain: Map<string, Path>,
): Path {
    let current = path;
    while (renameChain.has(current.toString())) {
        current = renameChain.get(current.toString())!;
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

// Distinct final paths across all events (rename sources collapse into their
// destination), so each lineage is keyed once by the path it ends life at.
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

