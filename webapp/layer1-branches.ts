// Task 357: the branch box's first tick fetches /api/layer1-branches once per loaded view and merges it in place.

import { closeBusyShield, openBusyShield, renderBusyShield, renderBusyShieldError } from "./layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, renderLayer1Progress } from "./layer1-progress.ts";
import type { WireBranch, WireBranchesView } from "./layer1-wire-branches.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

type BranchEntry = WireBranchesView["pairs"][number]["branches"][number];

const viewsWithBranches = new WeakSet<WireLayer1View>();

export function isBranchesLoaded(view: WireLayer1View): boolean {
  return viewsWithBranches.has(view);
}

function renderBothProgress(label: string, current?: number, total?: number): void {
  renderLayer1Progress(label, current, total);
  renderBusyShield(label, current, total);
}

// The payload carries no axisPx and a bare instant for each anchor; the client relayout places them.
function convertBranchEntry(entry: BranchEntry): WireBranch {
  const { forkAt, rejoinAt, nodes, ...rest } = entry;
  const placedNodes: WireBranch["nodes"] = [];
  for (const node of nodes) {
    placedNodes.push({ ...node, axisPx: 0 });
  }
  return {
    ...rest,
    forkAt: { instant: forkAt, axisPx: 0 },
    ...(rejoinAt === undefined ? {} : { rejoinAt: { instant: rejoinAt, axisPx: 0 } }),
    nodes: placedNodes,
  };
}

function convertBranchEntries(entries: BranchEntry[]): WireBranch[] {
  const convertedBranches: WireBranch[] = [];
  for (const entry of entries) {
    convertedBranches.push(convertBranchEntry(entry));
  }
  return convertedBranches;
}

// False when the user cancelled or the fetch failed (the shield then shows the error); the view is untouched.
export async function loadBranchesOnce(view: WireLayer1View): Promise<boolean> {
  const isAlreadyLoaded = viewsWithBranches.has(view);
  if (isAlreadyLoaded) {
    return true;
  }
  const params = new URLSearchParams(location.search);
  params.set("progress", "1");
  openBusyShield("starting");
  renderLayer1Progress("starting");
  let payload: WireBranchesView | undefined;
  try {
    payload = await readLayer1ViewStream<WireBranchesView>(`/api/layer1-branches?${params}`, renderBothProgress);
  }
  catch (error) {
    renderBusyShieldError(String(error));
    return false;
  }
  finally {
    hideLayer1Progress();
  }
  closeBusyShield();
  if (payload === undefined) {
    return false;
  }
  const branchesByPath = new Map<string, BranchEntry[]>();
  for (const entry of payload.pairs) {
    branchesByPath.set(entry.path, entry.branches);
  }
  for (const pair of view.pairs) {
    const branches = branchesByPath.get(pair.path);
    if (branches !== undefined) {
      pair.branches = convertBranchEntries(branches);
    }
  }
  viewsWithBranches.add(view);
  return true;
}
