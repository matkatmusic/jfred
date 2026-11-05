// Empty scroll space added at a pane's ends so a jump can centre nearby nodes.

function addSlackToSide(pane: HTMLElement, side: string, neededPx: number): boolean {
  if (neededPx <= 0) {
    return false;
  }
  const currentPx = parseFloat(pane.style.getPropertyValue(`--slack-${side}`)) || 0;
  pane.style.setProperty(`--slack-${side}`, `${currentPx + Math.ceil(neededPx)}px`);
  return true;
}

// A pane cannot scroll past its ends, so a node near one first gets empty space.
export function addSlackForEdgeNode(pane: HTMLElement, box: DOMRect, area: { left: number; right: number; top: number; bottom: number }): boolean {
  const targetLeft = pane.scrollLeft + (box.left + box.right) / 2 - (area.left + area.right) / 2;
  const targetTop = pane.scrollTop + (box.top + box.bottom) / 2 - (area.top + area.bottom) / 2;
  const hasAddedLeft = addSlackToSide(pane, "left", -targetLeft);
  const hasAddedRight = addSlackToSide(pane, "right", targetLeft - (pane.scrollWidth - pane.clientWidth));
  const hasAddedTop = addSlackToSide(pane, "top", -targetTop);
  const hasAddedBottom = addSlackToSide(pane, "bottom", targetTop - (pane.scrollHeight - pane.clientHeight));
  return hasAddedLeft || hasAddedRight || hasAddedTop || hasAddedBottom;
}
