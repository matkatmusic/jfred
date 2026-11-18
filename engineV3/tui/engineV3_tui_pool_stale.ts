// The stale-store check of the step pool.

import type { StepPoolOptions } from "./engineV3_tui_walk_types.ts";

export function isStoreStale(options: StepPoolOptions): boolean {
    if (options.isStoreStale === undefined) {
        return false;
    }
    return options.isStoreStale();
}
