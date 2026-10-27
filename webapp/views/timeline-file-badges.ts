// Rename-badge view-model: the Files sidebar and details "Files touched" list stamp entries here.

import type { FileSidebarEntry } from "./timeline-file-tree-sidebar.ts";
import type { WireRename, WireTimelineDocument } from "./timeline-types.ts";

// One rename badge: its entry, the old path's segments, and the suffix depth shown.
type RenameBadge = { entry: FileSidebarEntry; segments: string[]; depth: number };

// Stamp each renamed entry's renameBadgeLabel: start at the basename, deepen colliding badges until labels differ.
export function applyRenameBadgeLabels(entries: FileSidebarEntry[]): void {
  const badges: RenameBadge[] = [];
  for (const entry of entries) {
    if (entry.originalPath === undefined) {
      continue;
    }
    badges.push({ entry, segments: splitPathSegments(entry.originalPath), depth: 1 });
  }
  while (deepenCollidingBadges(badges)) {
    // repeat until no badge grew — each pass regroups by the freshly deepened labels.
  }
  for (const badge of badges) {
    badge.entry.renameBadgeLabel = computeBadgeLabel(badge);
  }
}

function splitPathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

// A badge's current label: the last `depth` segments of its old path.
function computeBadgeLabel(badge: RenameBadge): string {
  return badge.segments.slice(badge.segments.length - badge.depth).join("/");
}

// Deepen badges that share a label with a different old path; true when any grew.
function deepenCollidingBadges(badges: RenameBadge[]): boolean {
  const badgesByLabel = new Map<string, RenameBadge[]>();
  for (const badge of badges) {
    const label = computeBadgeLabel(badge);
    badgesByLabel.set(label, [...(badgesByLabel.get(label) ?? []), badge]);
  }
  let anyBadgeGrew = false;
  for (const group of badgesByLabel.values()) {
    for (const badge of findGrowableBadges(group)) {
      badge.depth += 1;
      anyBadgeGrew = true;
    }
  }
  return anyBadgeGrew;
}

// The same-label badges that must and can still grow; none when under two distinct old paths.
function findGrowableBadges(group: RenameBadge[]): RenameBadge[] {
  const distinctOldPaths = new Set(group.map((badge) => badge.segments.join("/")));
  if (distinctOldPaths.size < 2) {
    return [];
  }
  return group.filter((badge) => badge.depth < badge.segments.length);
}

// A script move leaves no rename revision, so fall back to the run's renamedPaths pair (tasks 143/145).
export function findScriptRenameSource(document: WireTimelineDocument, target: string): string | undefined {
  const pairs = (document.scriptRuns ?? []).flatMap((run) => run.renamedPaths ?? []);
  return pairs.find((pair) => checkRenamePairNamesTarget(pair, target))?.from;
}

// True when the pair's destination names `target` exactly or by trailing path segments.
function checkRenamePairNamesTarget(pair: WireRename, target: string): boolean {
  if (pair.to === target) {
    return true;
  }
  if (target.endsWith(`/${pair.to}`)) {
    return true;
  }
  return pair.to.endsWith(`/${target}`);
}
