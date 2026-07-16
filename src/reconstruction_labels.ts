// Shared display-label helpers for the reconstruction renderers: a change id shortened for printing
// and a path's base name. The one canonical home for both, imported directly by the list renderer and
// the graph renderer (no re-export shim — coding-requirements §2). Distinct from `shortUuid`
// (reconstruction_branch.ts), which shortens a branch tip's uuid.

import type { Path, Uuid } from "./structures/domain.ts";
import { toolUseIdPrefix } from "./regex_expressions.ts";

// A change id, shortened for display: drop a leading `toolu_`, keep 8 chars.
export function shortenChangeId(id: Uuid): string {
    return id.toString().replace(toolUseIdPrefix, "").slice(0, 8);
}

// The tail component of a path (its file name).
export function getBaseName(path: Path): string {
    const parts = path.toString().split("/");
    return parts[parts.length - 1]!;
}

