// Real-browser check of scrollToFirstVisibleNode: DOM-only setup, so no settings are written.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

const SCROLL_TIMEOUT_MS = 10_000;

// Keeps one visible node, pushes it off screen, calls the real module, and reports where the node ended up.
const RUN_FIRST_NODE_SCROLL = `(async () => {
    const { scrollToFirstVisibleNode } = await import('/app/layer1-first-node-scroll.js');
    const pane = document.getElementById('timelines');
    const visible = [...document.querySelectorAll('#stage .node')].filter(n => n.checkVisibility());
    if (visible.length === 0) return { visibleCount: 0 };
    const lastNode = visible[visible.length - 1];
    for (const node of visible) { if (node !== lastNode) node.style.display = 'none'; }
    const isOnScreen = () => {
        const p = pane.getBoundingClientRect(), r = lastNode.getBoundingClientRect();
        return r.bottom > p.top && r.top < p.bottom && r.right > p.left && r.left < p.right;
    };
    // The demo bundle fits one screen, so push the lone node far below it, then scroll to the top.
    lastNode.style.marginTop = '5000px';
    pane.scrollTo(0, 0);
    const onScreenBefore = isOnScreen();
    scrollToFirstVisibleNode();
    await new Promise(resolve => setTimeout(resolve, 500));
    return { visibleCount: visible.length, onScreenBefore, onScreenAfter: isOnScreen(), scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight };
})()`;

export async function checkFirstNodeScroll(page: HeadlessPage): Promise<void> {
  await page.waitFor(`document.querySelectorAll('#stage .node').length > 0`, SCROLL_TIMEOUT_MS);
  const result = await page.evaluate<{
    visibleCount: number; onScreenBefore?: boolean; onScreenAfter?: boolean; scrollHeight?: number; clientHeight?: number;
  }>(RUN_FIRST_NODE_SCROLL);
  reportCheck("first-node-scroll setup: the lone visible node starts off screen",
    result.visibleCount > 0 && result.onScreenBefore === false, result);
  reportCheck("first-node-scroll: scrollToFirstVisibleNode brings the lone node onto the screen", result.onScreenAfter === true, result);
}
