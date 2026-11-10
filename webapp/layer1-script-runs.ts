// Task 356: the script-run box's first tick fetches /api/layer1-script-runs once per loaded view and merges it in place.

import { closeBusyShield, openBusyShield, renderBusyShield, renderBusyShieldError } from "./layer1-components/popups/layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, renderLayer1Progress } from "./layer1-components/loading-bar/layer1-progress.ts";
import { loadSavedRunResult } from "./layer1-run-results.ts";
import type { WireScriptRun, WireScriptRunsView } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const viewsWithScriptRuns = new WeakSet<WireLayer1View>();

export function isScriptRunsLoaded(view: WireLayer1View): boolean {
  return viewsWithScriptRuns.has(view);
}

function renderBothProgress(label: string, current?: number, total?: number): void {
  renderLayer1Progress(label, current, total);
  renderBusyShield(label, current, total);
}

function convertScriptRuns(runs: WireScriptRunsView["pairs"][number]["scriptRuns"]): WireScriptRun[] {
  const placedRuns: WireScriptRun[] = [];
  for (const run of runs) {
    placedRuns.push({ ...run, axisPx: 0 });
  }
  return placedRuns;
}

// False when the user cancelled or the fetch failed (the shield then shows the error); the view is untouched.
export async function loadScriptRunsOnce(view: WireLayer1View): Promise<boolean> {
  const isAlreadyLoaded = viewsWithScriptRuns.has(view);
  if (isAlreadyLoaded) {
    return true;
  }
  openBusyShield("starting");
  renderLayer1Progress("starting");
  const payload = await fetchScriptRunsPayload();
  if (payload === undefined) {
    return false;
  }
  mergeScriptRunsPayload(view, payload);
  viewsWithScriptRuns.add(view);
  return true;
}

function buildScriptRunsUrl(): string {
  const params = new URLSearchParams(location.search);
  params.set("progress", "1");
  return `/api/layer1-script-runs?${params}`;
}

// Undefined when the user cancelled or the fetch failed (the shield then shows the error).
async function fetchScriptRunsPayload(): Promise<WireScriptRunsView | undefined> {
  let payload: WireScriptRunsView | undefined;
  try {
    payload = await readLayer1ViewStream<WireScriptRunsView>(buildScriptRunsUrl(), renderBothProgress);
  }
  catch (error) {
    renderBusyShieldError(String(error));
    return undefined;
  }
  finally {
    hideLayer1Progress();
  }
  closeBusyShield();
  return payload;
}

function mergeScriptRunsPayload(view: WireLayer1View, payload: WireScriptRunsView): void {
  const runsByPath = new Map<string, WireScriptRunsView["pairs"][number]["scriptRuns"]>();
  for (const entry of payload.pairs) {
    runsByPath.set(entry.path, entry.scriptRuns);
  }
  for (const pair of view.pairs) {
    const runs = runsByPath.get(pair.path);
    if (runs !== undefined) {
      pair.scriptRuns = convertScriptRuns(runs);
    }
  }
  for (const result of payload.results) {
    loadSavedRunResult(result);
  }
}
