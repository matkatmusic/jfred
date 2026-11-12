// Fetches one file's reverse walk from /api/layer1-reverse and remembers it in the reverse store.

import { closeBusyShield, openBusyShield, renderBusyShield, renderBusyShieldError } from "./layer1-components/popups/layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, renderLayer1Progress } from "./layer1-components/loading-bar/layer1-progress.ts";
import { readSourceParams } from "./layer1-components/top-bars/layer1-sources.ts";
import { storeReverseWalk } from "./layer1-reverse-store.ts";
import type { WireReverseWalk } from "./layer1-wire-reverse.ts";

function renderBothProgress(label: string, current?: number, total?: number): void {
  renderLayer1Progress(label, current, total);
  renderBusyShield(label, current, total);
}

// Rejects when the fetch fails or the user cancels; a failure also stays on the shield until closed.
export async function loadReverseWalk(path: string): Promise<WireReverseWalk> {
  const sourceParams = readSourceParams();
  const params = new URLSearchParams();
  // for (const key of ["dir", "jsonl"]) {
  for (const key of ["dir"]) {
    const value = sourceParams.get(key);
    if (value !== null) {
      params.set(key, value);
    }
  }
  for (const transcriptFolder of sourceParams.getAll("jsonl")) {
    params.append("jsonl", transcriptFolder);
  }
  for (const snapshotsFolder of sourceParams.getAll("snapshots")) {
    params.append("snapshots", snapshotsFolder);
  }
  params.set("path", path);
  params.set("progress", "1");
  openBusyShield("starting");
  renderLayer1Progress("starting");
  let walk: WireReverseWalk | undefined;
  try {
    walk = await readLayer1ViewStream<WireReverseWalk>(`/api/layer1-reverse?${params}`, renderBothProgress);
  }
  catch (error) {
    renderBusyShieldError(String(error));
    throw error;
  }
  finally {
    hideLayer1Progress();
  }
  closeBusyShield();
  if (walk === undefined) {
    throw new Error(`reverse walk of ${path} was cancelled`);
  }
  storeReverseWalk(walk);
  return walk;
}
