// Maps a drawn node (or its label) to the show row kind it belongs to.

import { ShowRowKind } from "./layer1-show-row.ts";

// A label takes the class of the dot before it; created is checked before disk (nodes carry both).
export function classifyNodeKind(element: HTMLElement): ShowRowKind | undefined {
  const dot = element.matches(".nlabel") ? element.previousElementSibling : element;
  if (dot === null) {
    return undefined;
  }
  if (dot.matches(".n-created")) {
    return ShowRowKind.created;
  }
  if (dot.matches(".n-commit")) {
    return ShowRowKind.commit;
  }
  if (dot.matches(".n-disk")) {
    return ShowRowKind.disk;
  }
  if (dot.matches(".n-snap")) {
    return ShowRowKind.snapshot;
  }
  if (dot.matches(".n-edit, .n-read")) {
    return ShowRowKind.edit;
  }
  if (dot.matches(".n-script")) {
    return ShowRowKind.scriptRun;
  }
  if (dot.matches(".bnode")) {
    return ShowRowKind.branch;
  }
  return undefined;
}
