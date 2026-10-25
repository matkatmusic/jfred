// Task 356: the script-run box's first tick fetches /api/layer1-script-runs once per loaded view and merges it in place.

import { closeBusyShield, openBusyShield, paintBusyShield, showBusyShieldError } from "./layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import type { WireScriptRunsView } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const viewsWithScriptRuns = new WeakSet<WireLayer1View>();

export function hasLoadedScriptRuns(view: WireLayer1View): boolean {
  return viewsWithScriptRuns.has(view);
}

// False when the user cancelled or the fetch failed (the shield then shows the error); the view is untouched.
export async function loadScriptRunsOnce(view: WireLayer1View): Promise<boolean> {
  if (viewsWithScriptRuns.has(view)) {
    return true;
  }
  const params = new URLSearchParams(location.search);
  params.set("progress", "1");
  openBusyShield("starting");
  showLayer1Progress("starting");
  let payload: WireScriptRunsView | undefined;
  try {
    payload = await readLayer1ViewStream<WireScriptRunsView>(`/api/layer1-script-runs?${params}`, (label, current, total) => {
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
  const runsByPath = new Map(payload.pairs.map((entry) => [entry.path, entry.scriptRuns]));
  for (const pair of view.pairs) {
    const runs = runsByPath.get(pair.path);
    if (runs !== undefined) {
      pair.scriptRuns = runs.map((run) => ({ ...run, axisPx: 0 }));
    }
  }
  viewsWithScriptRuns.add(view);
  return true;
}
