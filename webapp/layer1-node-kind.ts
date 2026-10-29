// Maps a drawn node (or its label) to the show row kind it belongs to.

import { ShowRowKind } from "./layer1-show-row.ts";

// Checked in order: created is checked before disk (nodes carry both).
const NODE_KIND_SELECTORS: readonly (readonly [string, ShowRowKind])[] = [
  [".n-created", ShowRowKind.created],
  [".n-commit", ShowRowKind.commit],
  [".n-disk", ShowRowKind.disk],
  [".n-snap", ShowRowKind.snapshot],
  [".n-edit, .n-read", ShowRowKind.edit],
  [".n-script", ShowRowKind.scriptRun],
  [".bnode", ShowRowKind.branch],
];

// A label takes the class of the dot before it.
export function readNodeKind(element: HTMLElement): ShowRowKind | undefined {
  const isLabel = element.matches(".nlabel");
  const dot = isLabel ? element.previousElementSibling : element;
  if (dot === null) {
    return undefined;
  }
  for (const [selector, kind] of NODE_KIND_SELECTORS) {
    const isKind = dot.matches(selector);
    if (isKind) {
      return kind;
    }
  }
  return undefined;
}
