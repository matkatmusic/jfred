// Task 343: the Edit box's first tick fetches /api/layer1-edits once per loaded view and merges it in place.

import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import type { WireEditsView, WireLayer1View } from "./layer1-wire.ts";

const viewsWithEdits = new WeakSet<WireLayer1View>();

export function hasLoadedEdits(view: WireLayer1View): boolean {
    return viewsWithEdits.has(view);
}

// False when the user cancelled the fetch; the view is untouched then. A failed fetch throws.
export async function loadEditsOnce(view: WireLayer1View): Promise<boolean> {
    if (viewsWithEdits.has(view)) {
        return true;
    }
    const params = new URLSearchParams(location.search);
    params.set("progress", "1");
    showLayer1Progress("starting");
    try {
        const payload = await readLayer1ViewStream<WireEditsView>(`/api/layer1-edits?${params}`);
        if (payload === undefined) {
            return false;
        }
        const editsByPath = new Map(payload.pairs.map((entry) => [entry.path, entry.edits]));
        for (const pair of view.pairs) {
            const edits = editsByPath.get(pair.path);
            if (edits !== undefined) {
                pair.edits = edits.map((edit) => ({ ...edit, axisPx: 0 }));
            }
        }
        viewsWithEdits.add(view);
        return true;
    }
    finally {
        hideLayer1Progress();
    }
}
