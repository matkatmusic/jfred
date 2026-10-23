// Task 357: the branch box's first tick fetches /api/layer1-branches once per loaded view and merges it in place.

import { closeBusyShield, openBusyShield, paintBusyShield, showBusyShieldError } from "./layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import type { WireBranch, WireBranchesView, WireLayer1View } from "./layer1-wire.ts";

const viewsWithBranches = new WeakSet<WireLayer1View>();

export function hasLoadedBranches(view: WireLayer1View): boolean {
    return viewsWithBranches.has(view);
}

// The payload carries no axisPx and a bare instant for each anchor; the client relayout places them.
function hydrateBranch(entry: WireBranchesView["pairs"][number]["branches"][number]): WireBranch {
    const { forkAt, rejoinAt, nodes, ...rest } = entry;
    return {
        ...rest,
        forkAt: { instant: forkAt, axisPx: 0 },
        ...(rejoinAt === undefined ? {} : { rejoinAt: { instant: rejoinAt, axisPx: 0 } }),
        nodes: nodes.map((node) => ({ ...node, axisPx: 0 })),
    };
}

// False when the user cancelled or the fetch failed (the shield then shows the error); the view is untouched.
export async function loadBranchesOnce(view: WireLayer1View): Promise<boolean> {
    if (viewsWithBranches.has(view)) {
        return true;
    }
    const params = new URLSearchParams(location.search);
    params.set("progress", "1");
    openBusyShield("starting");
    showLayer1Progress("starting");
    let payload: WireBranchesView | undefined;
    try {
        payload = await readLayer1ViewStream<WireBranchesView>(`/api/layer1-branches?${params}`, (label, current, total) => {
            showLayer1Progress(label, current, total);
            paintBusyShield(label, current, total);
        });
    }
    catch (error) {
        showBusyShieldError(String(error));
        return false;
    }
    finally {
        hideLayer1Progress();
    }
    closeBusyShield();
    if (payload === undefined) {
        return false;
    }
    const branchesByPath = new Map(payload.pairs.map((entry) => [entry.path, entry.branches]));
    for (const pair of view.pairs) {
        const branches = branchesByPath.get(pair.path);
        if (branches !== undefined) {
            pair.branches = branches.map(hydrateBranch);
        }
    }
    viewsWithBranches.add(view);
    return true;
}
