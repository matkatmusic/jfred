// Page-expression builders shared by the DiffView pane checks (tasks #324/#325/#326/#329).

import { BUBBLES, buildBubbleSelector } from "./mockup-checks.ts";

// A bubble with at least four clickable nodes, so a pair has somewhere to step to between its ends.
export const RICH_PATH = `(() => {
    const box = [...document.querySelectorAll('${BUBBLES}')]
        .find(b => b.querySelectorAll('.node:not(.n-created)').length >= 4);
    return box?.querySelector('.fname').dataset.path ?? null;
})()`;

// A bubble's clickable nodes in axis order: DOM order is ladder order, not time order.
export const listNodes = (path: string) => `[...document.querySelector('${buildBubbleSelector(path)}').querySelectorAll('.node:not(.n-created)')]
    .sort((a, b) => Number(a.style.getPropertyValue('--axis-px')) - Number(b.style.getPropertyValue('--axis-px')))`;

// The marker vocabulary a pane speaks for a lane node (layer1-revision-sources.ts).
export const MARKER_OF = `(dot => dot.classList.contains('n-commit') && dot.title ? dot.title.slice(0, 8)
    : dot.classList.contains('n-snap') ? '@v' + dot.dataset.version + ' 📸' : 'on disk')`;

// Clicks the Nth clickable node of a bubble; `shift` extends a selection into a pair (#305).
export const triggerNodeClick = (path: string, index: number, shift = false) => `(() => {
    const dot = ${listNodes(path)}[${index}];
    dot.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shift} }));
    return ${MARKER_OF}(dot);
})()`;

export const PANE = `[...document.querySelectorAll('#dbody details.dfile')].find(d => (d.querySelector('.dfile-path')?.dataset.target ?? ${RICH_PATH}) === ${RICH_PATH})`;
export const PANE_LABEL = `${PANE}.querySelector('.dpair').textContent`;
export const getPaneArrow = (index: number) => `[...${PANE}.querySelectorAll('summary .dtools button')][${index}]`;
export const getRingMarker = (cls: string) =>
  `(() => { const dot = document.querySelector('.${cls}'); return dot ? ${MARKER_OF}(dot) : null; })()`;
export const PANE_SETTLED =
  `${PANE}.querySelectorAll('.dfile-body .diff-line, .dfile-body .diff-cols, .dfile-body .dbinary').length > 0`;
export const INLINE_ROWS = `${PANE}.querySelectorAll('.dfile-body .diff-line').length`;
