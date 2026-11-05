// Browser-side expressions for the ruler review checks.

import { buildRecordDot } from "./layer7-probes.ts";

const PANE = `document.getElementById('timelines')`;
const SETTLE = `new Promise(resolve => setTimeout(resolve, 200))`;
const DOTS = `[...document.querySelectorAll('#annotation-track i.anode')].filter(d => d.getClientRects().length > 0)`;
const LEVEL_PX = 1;

export const DOT_FONT_SIZE = `getComputedStyle(document.querySelector('#annotation-track i.anode')).fontSize`;
export const CLOSE_DRAWER = `document.getElementById('dclose').click()`;
export const DRAWER_JSON_FILLED = `document.getElementById('drawer').classList.contains('open')
    && (box => box !== null && box.textContent !== '')(document.querySelector('#dbody .node-json'))`;
export const SNAPSHOT_TOGGLE_READY = `document.querySelectorAll('#dbody .json-toggle').length === 1`;

// `prepare` runs first: it scrolls the pane or clicks a row; the head is read after the pane settles.
export const buildHeadProbe = (prepare: string) => `(async () => { ${prepare}; await ${SETTLE};
    return { headTop: document.getElementById('ruler-head').getBoundingClientRect().top, paneTop: ${PANE}.getBoundingClientRect().top }; })()`;
export const HEAD_AT_REST = buildHeadProbe(`${PANE}.scrollTop = 0`);
export const HEAD_SCROLLED = buildHeadProbe(`${PANE}.scrollTop = 600`);
export const HEAD_AFTER_ROW_CLICK = buildHeadProbe(`${PANE}.scrollTop = 0; document.querySelector('#ruler .tick').click()`);

// A row in view is unmatched when no drawn dot centre is within 1px of its centre.
export const ROW_DOT_FACTS = `(() => {
    const centre = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
    const headBottom = document.getElementById('ruler-head').getBoundingClientRect().bottom;
    const paneBottom = ${PANE}.getBoundingClientRect().bottom;
    const dotCentres = ${DOTS}.map(centre);
    const rows = [...document.querySelectorAll('#ruler .tick')].map(centre).filter(c => c > headBottom && c < paneBottom);
    return { rowCount: rows.length, unmatchedCount: rows.filter(c => !dotCentres.some(d => Math.abs(d - c) <= ${LEVEL_PX})).length };
})()`;

export const buildSurfaceProbe = (selector: string) => `((box, filenav) => { const style = getComputedStyle(box);
    return { borderRightWidth: style.borderRightWidth, borderRightStyle: style.borderRightStyle, background: style.backgroundColor,
        filenavBackground: getComputedStyle(filenav).backgroundColor }; })(document.querySelector('${selector}'), document.querySelector('.filenav'))`;
export const buildMinimapEdgeProbe = (neighbourSelector: string) => `({ minimapLeft: document.querySelector('.minimap').getBoundingClientRect().left,
    neighbourRight: document.querySelector('${neighbourSelector}').getBoundingClientRect().right })`;

// Stack-0 dots of two neighbouring lanes: the pair closest in height gives the gap between their edges.
export const LANE_GAPS = `(() => {
    const dots = ${DOTS}.filter(d => d.style.getPropertyValue('--stack') === '0')
        .map(d => ({ lane: parseFloat(d.style.getPropertyValue('--lane-x')), box: d.getBoundingClientRect() }));
    const lanes = [...new Set(dots.map(d => d.lane))].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i + 1 < lanes.length; i++) {
        const pairs = dots.filter(d => d.lane === lanes[i]).flatMap(left => dots.filter(d => d.lane === lanes[i + 1])
            .map(right => ({ apart: Math.abs(left.box.top - right.box.top), gap: right.box.left - left.box.right })));
        if (pairs.length > 0) gaps.push(pairs.sort((a, b) => a.apart - b.apart)[0].gap);
    }
    return gaps;
})()`;

export const BRACKET_INSET_FACTS = `(() => {
    const trackLeft = document.getElementById('annotation-track').getBoundingClientRect().left;
    const insets = [...document.querySelectorAll('#annotation-track .abracket')].map(b => b.getBoundingClientRect().left - trackLeft);
    return { count: insets.length, minInset: Math.min(...insets) };
})()`;

// The drawer body is emptied first, so a drawer left open earlier cannot answer for this click.
export const buildDotClick = (id: string) => `(() => { document.getElementById('dbody').replaceChildren(); ${buildRecordDot(id)}.click(); })()`;
export const buildDotDrawerFacts = (id: string) => `({ title: document.getElementById('dpath').textContent,
    label: ${buildRecordDot(id)}.dataset.recordLabel, json: document.querySelector('#dbody .node-json').textContent })`;

export const SNAPSHOT_CLICK = `(() => { document.getElementById('dbody').replaceChildren(); document.querySelector('i.n-snap').click(); })()`;
export const SNAPSHOT_TOGGLE_CLICK = `document.querySelector('#dbody .json-toggle').click()`;
export const SNAPSHOT_JSON_FILLED = `(box => box !== null && !box.hidden && box.textContent !== '')(document.querySelector('#dbody .node-json'))`;
export const SNAPSHOT_DRAWER_FACTS = `({ buttonTexts: [...document.querySelectorAll('#dbody .json-toggle')].map(b => b.textContent),
    isJsonShown: !document.querySelector('#dbody .node-json').hidden, json: document.querySelector('#dbody .node-json').textContent })`;
