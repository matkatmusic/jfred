// Display-label helpers: shortened change ids and path base names for renderers.

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

