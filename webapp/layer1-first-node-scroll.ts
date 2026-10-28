// After first render: if no visible node is in the timeline pane, scroll the topmost into view.

import { getRequiredElementById } from "./app-dom.ts";

interface NodeBox {
  node: HTMLElement;
  rect: DOMRect;
}

function collectVisibleNodeBoxes(): NodeBox[] {
  const boxes: NodeBox[] = [];
  for (const node of document.querySelectorAll<HTMLElement>("#stage .node")) {
    const isVisible = node.checkVisibility();
    if (isVisible) {
      boxes.push({ node, rect: node.getBoundingClientRect() });
    }
  }
  return boxes;
}

function isInsidePane(rect: DOMRect, pane: DOMRect): boolean {
  const isBelowPaneTop = rect.bottom > pane.top;
  const isAbovePaneBottom = rect.top < pane.bottom;
  const isRightOfPaneLeft = rect.right > pane.left;
  const isLeftOfPaneRight = rect.left < pane.right;
  const isInsideVertically = isBelowPaneTop && isAbovePaneBottom;
  const isInsideHorizontally = isRightOfPaneLeft && isLeftOfPaneRight;
  return isInsideVertically && isInsideHorizontally;
}

function findTopmostBox(boxes: NodeBox[]): NodeBox {
  let topmost = boxes[0]!;
  for (const box of boxes) {
    if (box.rect.top < topmost.rect.top) {
      topmost = box;
    }
  }
  return topmost;
}

export function moveFirstVisibleNodeIntoView(): void {
  const pane = getRequiredElementById("timelines").getBoundingClientRect();
  const boxes = collectVisibleNodeBoxes();
  if (boxes.length === 0) {
    return;
  }
  for (const box of boxes) {
    const isOnScreen = isInsidePane(box.rect, pane);
    if (isOnScreen) {
      return;
    }
  }
  // Native scrollIntoView, like landOnBubble: it works under the CSS zoom without any arithmetic.
  findTopmostBox(boxes).node.scrollIntoView({ block: "center", inline: "center" });
}
