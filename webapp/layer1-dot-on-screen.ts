// Layer 1 dot on-screen test: shared by the run viewport and the blocked popup, so neither imports the other.

export type PaneBounds = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

export function isDotOnScreen(dot: HTMLElement, pane: PaneBounds): boolean {
  const rect = dot.getBoundingClientRect();
  const isSized = rect.width > 0 && rect.height > 0;
  const isInsideAcross = rect.right > pane.left && rect.left < pane.right;
  const isInsideDown = rect.bottom > pane.top && rect.top < pane.bottom;
  return isSized && isInsideAcross && isInsideDown;
}
