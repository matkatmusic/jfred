// After the page's first render: when no visible node is inside the timeline pane, bring the topmost visible one into view.

import { getRequiredElementById } from "./app-dom.ts";

export function scrollToFirstVisibleNode(): void {
  const pane = getRequiredElementById("timelines").getBoundingClientRect();
  const visibleNodes = [...document.querySelectorAll<HTMLElement>("#stage .node")]
    .filter((node) => node.checkVisibility())
    .map((node) => ({ node, rect: node.getBoundingClientRect() }));
  const isOnScreen = visibleNodes.some(({ rect }) =>
    rect.bottom > pane.top && rect.top < pane.bottom && rect.right > pane.left && rect.left < pane.right);
  if (isOnScreen || visibleNodes.length === 0) {
    return;
  }
  const topmost = visibleNodes.reduce((best, candidate) => candidate.rect.top < best.rect.top ? candidate : best);
  // Native scrollIntoView, like landOnBubble: it works under the CSS zoom without any arithmetic.
  topmost.node.scrollIntoView({ block: "center", inline: "center" });
}
