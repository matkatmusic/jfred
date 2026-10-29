// Task 343: the Edit box's first tick fetches /api/layer1-edits once per loaded view and merges it in place.

import { closeBusyShield, openBusyShield, renderBusyShield, renderBusyShieldError } from "./layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, renderLayer1Progress } from "./layer1-progress.ts";
import type { WireEdit, WireEditsView } from "./layer1-wire-edits.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const viewsWithEdits = new WeakSet<WireLayer1View>();

export function isEditsLoaded(view: WireLayer1View): boolean {
  return viewsWithEdits.has(view);
}

function renderBothProgress(label: string, current?: number, total?: number): void {
  renderLayer1Progress(label, current, total);
  renderBusyShield(label, current, total);
}

function convertEdits(edits: WireEditsView["pairs"][number]["edits"]): WireEdit[] {
  const placedEdits: WireEdit[] = [];
  for (const edit of edits) {
    placedEdits.push({ ...edit, axisPx: 0 });
  }
  return placedEdits;
}

// False when the user cancelled or the fetch failed (the shield then shows the error); the view is untouched.
export async function loadEditsOnce(view: WireLayer1View): Promise<boolean> {
  const isAlreadyLoaded = viewsWithEdits.has(view);
  if (isAlreadyLoaded) {
    return true;
  }
  const params = new URLSearchParams(location.search);
  params.set("progress", "1");
  openBusyShield("starting");
  renderLayer1Progress("starting");
  let payload: WireEditsView | undefined;
  try {
    payload = await readLayer1ViewStream<WireEditsView>(`/api/layer1-edits?${params}`, renderBothProgress);
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
  const editsByPath = new Map<string, WireEditsView["pairs"][number]["edits"]>();
  for (const entry of payload.pairs) {
    editsByPath.set(entry.path, entry.edits);
  }
  for (const pair of view.pairs) {
    const edits = editsByPath.get(pair.path);
    if (edits !== undefined) {
      pair.edits = convertEdits(edits);
    }
  }
  viewsWithEdits.add(view);
  return true;
}
