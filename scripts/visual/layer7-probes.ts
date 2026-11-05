// Layer 7 browser-side expressions: ids, scroll helpers and page probes shared by the Layer 7 checks.

import { TOOL_NODE_PATH } from "../../src/viewer_api_layer7_fixture_data.ts";
import { ANNOTATION_MARGIN_PX } from "../../webapp/layer1-annotation-window.ts";
import { type HeadlessPage } from "./cdp.ts";
import { buildBubbleSelector } from "./mockup-checks.ts";

export const COLUMN_PAIR_ID = "toolu_fixture_l7_bash";
export const BUBBLE_PAIR_ID = "toolu_fixture_l7_grep";

// The session column is off at load: this click turns it on.
export const CLICK_SESSION_TOGGLE = `document.getElementById('session-toggle').click()`;
export const TRACK_PRESENT = `document.getElementById('annotation-track') !== null`;
const TRACK_WAIT_MS = 10_000;

export async function openSessionColumn(page: HeadlessPage): Promise<void> {
  await page.evaluate(CLICK_SESSION_TOGGLE);
  await page.waitFor(TRACK_PRESENT, TRACK_WAIT_MS);
}

const PANE = `document.getElementById('timelines')`;
const SETTLE = `new Promise(resolve => setTimeout(resolve, 150))`;
const VIZ_ROOT = `document.querySelector('.viz-root')`;
export const DRAWN_NODES = `document.querySelectorAll('#annotation-track i.anode')`;
export const DISPATCHER_BUBBLE = `document.querySelector(${JSON.stringify(buildBubbleSelector(TOOL_NODE_PATH))})`;
export const HIDDEN_KINDS = `(${VIZ_ROOT}.getAttribute('data-hidden-kinds') ?? '')`;
export const REQUEST_COUNT = `performance.getEntriesByType('resource').length`;
export const buildKindBoxStates = (skippedKind: string) => `[...document.querySelectorAll('#show-row input[data-kind]')]
    .filter(i => i.dataset.kind !== '${skippedKind}').map(i => i.dataset.kind + ':' + i.checked).join(',')`;

// A huge top clamps to the bottom; the wait lets the scroll handler redraw the column.
export const buildScrollTo = (top: number, left: number) =>
  `(async () => { const pane = ${PANE}; pane.scrollTop = ${top}; pane.scrollLeft = ${left}; await ${SETTLE}; return pane.scrollLeft; })()`;
export const SCROLL_HOME = buildScrollTo(0, 0);

export const HIDE_BOX = `document.getElementById('hide-ignored')`;
export const buildSetHideIgnored = (isOn: boolean) => `(box => { if (box.checked !== ${isOn}) box.click(); })(${HIDE_BOX})`;
export const buildHideSettled = (isOn: boolean) => `${VIZ_ROOT}.hasAttribute('data-hide-ignored') === ${isOn}`;
export const buildRecordDot = (id: string) => `document.querySelector('i[data-record-id="${id}"]')`;

// Task 383: the jfred strip may sit between the column and the stage.
export const TRACK_FACTS = `(() => {
    const track = document.getElementById('annotation-track');
    const before = document.getElementById('stage').previousElementSibling;
    const isStripAfterTrack = before.id === 'jfred-strip' && before.previousElementSibling === track;
    return { count: document.querySelectorAll('#annotation-track').length,
        isAfterRuler: document.getElementById('ruler').nextElementSibling === track,
        isBeforeStage: before === track || isStripAfterTrack,
        position: getComputedStyle(track).position };
})()`;

// export const COLUMN_NODE_FACTS = `[...${DRAWN_NODES}].map(n => {
//     const style = getComputedStyle(n);
//     const box = n.getBoundingClientRect();
//     const label = document.querySelector('#annotation-track .alabel[data-record-id="' + n.dataset.recordId + '"]');
//     const text = label ? label.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
//     return { id: n.dataset.recordId, classes: n.className, instant: n.dataset.instant, pairId: n.dataset.pairId,
//         cx: box.left + box.width / 2, cy: box.top + box.height / 2, borderStyle: style.borderTopStyle,
//         label: label ? label.textContent : '', nodeBox: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, labelBox: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
//         signature: [style.borderRadius, style.borderTopStyle, style.borderTopColor, style.backgroundColor, style.width, style.transform].join('|') };
// })`;
export const COLUMN_NODE_FACTS = `[...${DRAWN_NODES}].map(n => {
    const box = n.getBoundingClientRect();
    return { id: n.dataset.recordId, classes: n.className, instant: n.dataset.instant, pairId: n.dataset.pairId,
        sessionId: n.dataset.sessionId, letter: n.textContent, recordLabel: n.dataset.recordLabel,
        backgroundColor: getComputedStyle(n).backgroundColor, stack: Number(n.style.getPropertyValue('--stack')),
        cx: box.left + box.width / 2, cy: box.top + box.height / 2,
        nodeBox: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } };
})`;
export const TRACK_LABEL_COUNT = `document.querySelectorAll('#annotation-track .alabel').length`;

// Drawn ids at the top and the bottom, and drawn nodes outside the pane plus margin.
export const WINDOW_FACTS = `(async () => {
    const pane = ${PANE};
    const zoom = Number(${VIZ_ROOT}.style.getPropertyValue('--zoom') || 1);
    let outsideCount = 0;
    const read = async top => {
        pane.scrollTop = top;
        await ${SETTLE};
        const nodes = [...${DRAWN_NODES}];
        const firstAllowed = pane.scrollTop / zoom - ${ANNOTATION_MARGIN_PX} - 1;
        const lastAllowed = (pane.scrollTop + pane.clientHeight) / zoom + ${ANNOTATION_MARGIN_PX} + 1;
        for (const n of nodes) {
            const axisPx = Number(n.style.getPropertyValue('--axis-px'));
            if (axisPx < firstAllowed || axisPx > lastAllowed) outsideCount += 1;
        }
        return nodes.map(n => n.dataset.recordId);
    };
    const topIds = await read(0);
    const bottomIds = await read(pane.scrollHeight);
    await read(0);
    return { topIds, bottomIds, outsideCount };
})()`;
// Retired pixel version: it ignored the canvas offset, so edge dots failed.
//     const slack = (${ANNOTATION_MARGIN_PX} + laneY) * zoom + 2; box.top < frame.top - slack || box.bottom > frame.bottom + slack

// export const FULL_SCROLL_IDS = `(async () => {
//     const pane = ${PANE};
//     const seen = new Set();
//     for (let top = 0; top < pane.scrollHeight; top += pane.clientHeight) {
//         pane.scrollTop = top;
//         await ${SETTLE};
//         for (const n of ${DRAWN_NODES}) seen.add(n.dataset.recordId);
//     }
//     pane.scrollTop = 0;
//     await ${SETTLE};
//     return [...seen];
// })()`;

// Scrolls the pane once; keeps one value per key over every drawn node.
const buildFullScrollProbe = (keyExpression: string, valueExpression: string) => `(async () => {
    const pane = ${PANE};
    const seen = new Map();
    for (let top = 0; top < pane.scrollHeight; top += pane.clientHeight) {
        pane.scrollTop = top;
        await ${SETTLE};
        for (const n of ${DRAWN_NODES}) seen.set(${keyExpression}, ${valueExpression});
    }
    pane.scrollTop = 0;
    await ${SETTLE};
    return [...seen.values()];
})()`;
export const FULL_SCROLL_IDS = buildFullScrollProbe("n.dataset.recordId", "n.dataset.recordId");
export const SESSION_DOT_COLOURS = buildFullScrollProbe("n.dataset.sessionId + '|' + getComputedStyle(n).backgroundColor",
  "({ sessionId: n.dataset.sessionId, backgroundColor: getComputedStyle(n).backgroundColor })");

export const DUPLICATE_FACTS = `({
    stageParts: document.querySelectorAll('#stage .anode, #stage .alabel, #stage .abracket').length,
    trackTools: document.querySelectorAll('#annotation-track .tnode').length,
    ids: [...document.querySelectorAll('i.anode, i.tnode')].map(n => n.dataset.recordId) })`;

// `root` is `document` for the column or a bubble expression for its tool bracket.
export const buildBracketProbe = (root: string, selector: string) => `(list => {
    const first = list[0];
    const box = first ? first.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, right: 0 };
    return { count: list.length, style: first ? getComputedStyle(first).borderTopStyle : '', top: box.top, bottom: box.bottom, left: box.left, right: box.right };
})([...${root}.querySelectorAll(${JSON.stringify(selector)})])`;

export const COLUMN_RULE_TEXTS = `[...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    .filter(rule => /\\.(anode|alabel|abracket|atrack|tnode|tlabel|tbracket|a-[a-z-]+|sline|ahead|ruler-head|session-toggle|ttime|tcount|s-coloured|tf-[a-z-]+|hover-popup|hp-line)\\b/.test(rule.selectorText ?? ''))
    .map(rule => rule.cssText)`;
// Retired: token rules now use plain .viz-root, so no --page skip.
//     .filter(rule => rule.style.getPropertyValue('--page') === '')

export const IGNORED_FACTS = `(() => {
    const box = ${HIDE_BOX};
    const shown = list => list.filter(n => n.getClientRects().length > 0);
    const nodes = [...${DRAWN_NODES}];
    const ignored = nodes.filter(n => n.classList.contains('is-ignored'));
    const others = nodes.filter(n => !n.classList.contains('is-ignored'));
    return { text: box.parentElement.textContent, isChecked: box.checked, hasAttribute: ${buildHideSettled(true)},
        ignoredCount: ignored.length, ignoredShown: shown(ignored).length, otherShown: shown(others).length,
        opacities: ignored.map(n => Number(getComputedStyle(n).opacity)), hiddenKinds: ${HIDDEN_KINDS},
        kindBoxes: ${buildKindBoxStates("")}, requests: ${REQUEST_COUNT} };
})()`;

export const TOOL_BOX = `document.querySelector('#show-row input[data-kind="tool"]')`;
export const TOOL_BOX_FACTS = `(() => {
    const box = ${TOOL_BOX};
    const shown = selector => [...document.querySelectorAll(selector)].filter(n => n.getClientRects().length > 0).length;
    return { exists: box !== null, isChecked: box?.checked, label: box?.parentElement.textContent.trim(),
        hiddenKinds: ${HIDDEN_KINDS}, otherBoxes: ${buildKindBoxStates("tool")},
        toolShown: shown('i.tnode, .tlabel, .tbracket'), columnToolShown: shown('#annotation-track i[data-pair-id="${COLUMN_PAIR_ID}"]') };
})()`;

export const CLICK_TOOL_NODE = `(async () => {
    await ${SETTLE};
    const before = ${REQUEST_COUNT};
    document.querySelector('i.tnode').click();
    await ${SETTLE};
    return { isOpen: document.getElementById('drawer').classList.contains('open'), requests: ${REQUEST_COUNT} - before };
})()`;

export const BUBBLE_TOOL_FACTS = `(bubble => {
    const centre = e => { const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
    return { tnodes: [...bubble.querySelectorAll('i.tnode')].map(n => ({ ...centre(n), classes: n.className })),
        dotX: centre(bubble.querySelector('i.node')).cx, pageToolNodes: document.querySelectorAll('i.tnode').length,
        bubbleColumnNodes: document.querySelectorAll('.filebox .anode').length,
        pairIds: [...document.querySelectorAll('.abracket, .tbracket')].map(e => e.dataset.pairId) };
})(${DISPATCHER_BUBBLE})`;
export const SCROLL_TO_BUBBLE_PAIR = `(b => { b.querySelector('.tbracket').scrollIntoView({ block: 'center', inline: 'start' });
    ${PANE}.scrollBy(-390, 0); })(${DISPATCHER_BUBBLE})`;
