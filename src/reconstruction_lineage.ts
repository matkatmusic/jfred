// Track a file across renames into one unified history.

import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { FileEvent } from "./reconstruction_events.ts";

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
export function getFinalPath(
  path: Path,
  renameChain: Map<string, Path>,
): Path {
  let current = path;
  const seen = new Set<string>([current.toString()]);
  while (renameChain.has(current.toString())) {
    const next = renameChain.get(current.toString())!;
    const nextKey = next.toString();
    const isCycle = seen.has(nextKey);
    if (isCycle) {
      return current;
    }
    seen.add(nextKey);
    current = next;
  }
  return current;
}

// The path a content event touches; for a rename or copy it is the destination.
export function getContentPath(event: FileEvent): Path {
  if (event.kind === EventKind.rename) {
    return event.to;
  }
  if (event.kind === EventKind.copy) {
    return event.to;
  }
  return event.target;
}

// Whether an event belongs to the lineage that ends at finalTarget.
export function isEventInLineage(
  event: FileEvent,
  finalTarget: Path,
  renameChain: Map<string, Path>,
): boolean {
  return getFinalPath(getContentPath(event), renameChain).equals(finalTarget);
}

// Unique lineage keys: rename sources collapse to their final destination.
export function collectDistinctFinalPaths(
  events: FileEvent[],
  renameChain: Map<string, Path>,
): Path[] {
  const byPath = new Map<string, Path>();
  for (const event of events) {
    const finalPath = getFinalPath(getContentPath(event), renameChain);
    byPath.set(finalPath.toString(), finalPath);
  }
  return [...byPath.values()];
}

