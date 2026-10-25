// Task 343: the Edit box's first tick fetches /api/layer1-edits once per loaded view and merges it in place.

import { closeBusyShield, openBusyShield, paintBusyShield, showBusyShieldError } from "./layer1-busy-shield.ts";
import { hideLayer1Progress, readLayer1ViewStream, showLayer1Progress } from "./layer1-progress.ts";
import type { WireEditsView } from "./layer1-wire-edits.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const viewsWithEdits = new WeakSet<WireLayer1View>();

export function hasLoadedEdits(view: WireLayer1View): boolean {
  return viewsWithEdits.has(view);
}

// False when the user cancelled or the fetch failed (the shield then shows the error); the view is untouched.
export async function loadEditsOnce(view: WireLayer1View): Promise<boolean> {
  if (viewsWithEdits.has(view)) {
    return true;
  }
  const params = new URLSearchParams(location.search);
  params.set("progress", "1");
  openBusyShield("starting");
  showLayer1Progress("starting");
  let payload: WireEditsView | undefined;
  try {
    payload = await readLayer1ViewStream<WireEditsView>(`/api/layer1-edits?${params}`, (label, current, total) => {
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
