// Ruler UI probes: browser-side expressions for the five mockup states of the L9 ruler redesign.

import { buildRecordDot } from "./layer7-probes.ts";
import { buildClickById } from "./layer9-probes.ts";

export interface Box { left: number; right: number; top: number; bottom: number }
export interface HoverFacts { isVisible: boolean; box: Box | null; background: string; lines: string[]; target: Box; targetBackground: string; hasTitle: boolean; isHiddenAfter: boolean }
export const RULER_UI_SCREENSHOTS = { default: "21-ruler-default", expanded: "22-ruler-expanded", session: "23-ruler-session", commits: "24-ruler-commits", both: "25-ruler-both" } as const;
export const FIXTURE_TICK_COUNT = 419;
export const WAIT_MS = 10_000;

const PANE = `document.getElementById('timelines')`;
const SETTLE = `new Promise(resolve => setTimeout(resolve, 200))`;
const TICKS = `[...document.querySelectorAll('#ruler .tick')]`;
const BOX = `(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })`;
const TICK_LABEL = `(at => at.slice(5, 10) + ' ' + at.slice(11, 23))`;
const IS_HIDDEN = `(e => e === null || e.hidden || getComputedStyle(e).display === 'none')`;

// Counts console errors after this call; the page load itself is not covered.
export const ERROR_HOOK = `(() => { window.__rulerErrors = []; const original = console.error;
    console.error = (...args) => { window.__rulerErrors.push(args.join(' ')); original(...args); };
    window.addEventListener('error', event => window.__rulerErrors.push(event.message)); return true; })()`;
export const QUIET_FACTS = `({ errors: window.__rulerErrors === undefined ? -1 : window.__rulerErrors.length, isIdle: document.getElementById('loadbar').hidden })`;
export const STAGE_LEFT = `document.getElementById('stage').getBoundingClientRect().left`;
export const SESSION_TOGGLE_CLICK = buildClickById("session-toggle");

export const HEAD_FACTS = `(head => ({ isFirstChild: document.getElementById('ruler').firstElementChild === head, headButtons: head.querySelectorAll('button').length,
    headText: head.textContent.trim(), hasJfredButton: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'jfred'),
    trackCount: document.querySelectorAll('#annotation-track').length, stripCount: document.querySelectorAll('#jfred-strip').length }))(document.getElementById('ruler-head'))`;
export const COLOUR_FACTS = `({ coloured: document.querySelectorAll('#ruler .tick.s-coloured').length,
    withProperty: ${TICKS}.filter(t => t.style.getPropertyValue('--session-color') !== '').length })`;
export const HEAD_SCROLL_FACTS = `(async () => {
    const pane = ${PANE};
    const read = async top => { pane.scrollTop = top; await ${SETTLE}; const head = document.getElementById('ruler-head'); const box = head.getBoundingClientRect();
        return { height: box.height, offset: box.top - pane.getBoundingClientRect().top, borderStyle: getComputedStyle(head).borderBottomStyle, tickTop: document.querySelector('#ruler .tick').getBoundingClientRect().top }; };
    const home = await read(0); const scrolled = await read(800); await read(0);
    return { home, scrolled };
})()`;
export const TICK_TEXT_FACTS = `({ leaders: document.querySelectorAll('#leaders .leader').length, ticks: ${TICKS}.map(t => ({
    time: t.querySelector(':scope > .ttime')?.textContent ?? '', count: t.querySelector(':scope > .tcount')?.textContent ?? '', fullTime: t.dataset.fullTime ?? '', title: t.title })) })`;
// The axis line of a tick is the 1px top border of the leader with the same index.
export const DASH_FACTS = `(leaders => ${TICKS}.map((t, i) => [t, leaders[i].getBoundingClientRect()]).filter(([t]) => t.querySelectorAll('.kdash').length > 0)
    .map(([t, leader]) => ({ time: ${BOX}(t.querySelector('.ttime')), dashes: ${BOX}(t.querySelector('.kind-dashes')), axisY: leader.top + 0.5 })))([...document.querySelectorAll('#leaders .leader')])`;
export const LAYOUT_FACTS = `((ruler, stage) => ({ rulerWidth: ruler.getBoundingClientRect().width, isBeforeStage: stage.previousElementSibling === ruler,
    gap: stage.getBoundingClientRect().left - ruler.getBoundingClientRect().right,
    expectedGap: parseFloat(getComputedStyle(document.querySelector('.canvas')).columnGap) + parseFloat(getComputedStyle(stage).marginLeft) }))(document.getElementById('ruler'), document.getElementById('stage'))`;

// Clicks the multi-event row with most kinds, then finds it again by full time.
export const EXPAND_CLICK = `(async () => {
    const dashCount = t => t.querySelectorAll('.kdash').length;
    const key = ${TICKS}.filter(t => t.classList.contains('multi')).sort((a, b) => dashCount(b) - dashCount(a))[0].dataset.fullTime;
    const findTick = () => ${TICKS}.find(t => t.dataset.fullTime === key);
    const readNextTop = () => ${TICKS}[${TICKS}.indexOf(findTick()) + 1].getBoundingClientRect().top;
    const nextBefore = readNextTop(); findTick().click(); await ${SETTLE};
    const open = findTick();
    const probe = document.createElement('i'); probe.style.color = 'var(--ink)'; open.append(probe);
    const ink = getComputedStyle(probe).color; probe.remove();
    const dashColors = {};
    for (const dash of open.querySelectorAll('.kdash')) dashColors[[...dash.classList].find(c => c.startsWith('kdash-')).slice(6)] = getComputedStyle(dash).backgroundColor;
    const count = open.querySelector(':scope > .tcount');
    return { isExpanded: open.classList.contains('expanded'), countDisplay: getComputedStyle(count).display, expectedCount: Number(count.textContent.replace(/\\D/g, '')),
        time: ${BOX}(open.querySelector('.ttime')), dashes: ${BOX}(open.querySelector('.kind-dashes')), dashColors, ink,
        buttons: [...open.querySelectorAll('.tickfiles button')].map(b => ({ text: b.textContent, kind: [...b.classList].find(c => c.startsWith('tf-')) ?? '', color: getComputedStyle(b).color })),
        listHeight: open.querySelector('.tickfiles').getBoundingClientRect().height, nextBefore, nextAfter: readNextTop() };
})()`;
export const ESCAPE_CLOSE = `(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await ${SETTLE};
    return { expanded: document.querySelectorAll('#ruler .tick.expanded').length, tickFiles: document.querySelectorAll('.tickfiles').length }; })()`;
export const SCROLL_EXPANDED = `(async () => { document.querySelector('#ruler .tick.expanded').scrollIntoView({ block: 'center' }); await ${SETTLE}; return true; })()`;
export const SINGLE_CLICK =`(async () => { ${TICKS}.find(t => t.querySelector(':scope > .tcount')?.textContent === '(1)').click(); await ${SETTLE};
    return { tickFiles: document.querySelectorAll('.tickfiles').length, found: document.querySelectorAll('.found').length, foundBoxes: document.querySelectorAll('.filebox.found').length }; })()`;

export const SESSION_FACTS = `((toggle, track) => ({ isCurrent: toggle.classList.contains('current'), background: getComputedStyle(toggle).backgroundColor, trackLeft: track.left,
    trackWidth: track.width, rulerRight: document.getElementById('ruler').getBoundingClientRect().right, stageLeft: ${STAGE_LEFT},
    laneXs: [...new Set([...document.querySelectorAll('#annotation-track .sline')].map(l => l.style.getPropertyValue('--lane-x')))] }))
    (document.getElementById('session-toggle'), document.getElementById('annotation-track').getBoundingClientRect())`;
// Scrolls the whole pane once: every dot drawn on the way is read, then the ticks.
export const SESSION_SCAN = `(async () => {
    const pane = ${PANE}; const letters = new Set(); const colours = {}; const backgrounds = {}; let titled = 0;
    for (let top = 0; top < pane.scrollHeight; top += pane.clientHeight) {
        pane.scrollTop = top; await ${SETTLE};
        for (const dot of document.querySelectorAll('#annotation-track i.anode')) {
            const colour = dot.style.getPropertyValue('--session-color');
            letters.add(dot.textContent); titled += dot.hasAttribute('title') ? 1 : 0;
            (colours[dot.dataset.sessionId] ??= new Set()).add(colour); backgrounds[colour] = getComputedStyle(dot).backgroundColor;
        }
    }
    pane.scrollTop = 0; await ${SETTLE};
    return { letters: [...letters], titled, alabels: document.querySelectorAll('#annotation-track .alabel').length, colours: Object.values(colours).map(set => [...set]),
        coloured: ${TICKS}.filter(t => t.classList.contains('s-coloured')).map(t => ({ computed: getComputedStyle(t).color, expected: backgrounds[t.style.getPropertyValue('--session-color')] })) };
})()`;
// One session line against one drawn dot: the dot centre is the expected line end.
export const buildLineProbe = (sessionId: string, dotId: string) => `((line, dot) => ({ laneX: line.style.getPropertyValue('--lane-x'), top: line.getBoundingClientRect().top,
    bottom: line.getBoundingClientRect().bottom, dotCy: dot.getBoundingClientRect().top + dot.getBoundingClientRect().height / 2 }))
    (document.querySelector('#annotation-track .sline[data-session-id="${sessionId}"]'), ${buildRecordDot(dotId)})`;
export const IGNORED_DOT_FACTS = `[...document.querySelectorAll('#annotation-track i.anode.is-ignored')].map(dot => ({ display: getComputedStyle(dot).display,
    opacity: Number(getComputedStyle(dot).opacity), cy: dot.getBoundingClientRect().top + dot.getBoundingClientRect().height / 2 }))`;
export const OFF_FACTS = `({ trackCount: document.querySelectorAll('#annotation-track').length,
    trackWidth: getComputedStyle(document.querySelector('.canvas')).getPropertyValue('--track-w').trim(), stageLeft: ${STAGE_LEFT} })`;

export const buildScrollToDot = (id: string) => `(async () => {
    const pane = ${PANE};
    const find = () => document.querySelector('#annotation-track i[data-record-id="${id}"]');
    for (let top = 0; find() === null && top <= pane.scrollHeight; top += pane.clientHeight / 2) { pane.scrollTop = top; await ${SETTLE}; }
    pane.scrollTop += find().getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2; await ${SETTLE}; return true;
})()`;
export const buildDotCentre = (id: string) => `(r => r.top + r.height / 2)(${buildRecordDot(id)}.getBoundingClientRect())`;
// minGap is the distance to the nearest tick centre; isBetween means one tick lies above and the next below.
export const buildMidProbe = (id: string) => `((dot, cys) => ({ minGap: Math.min(...cys.map(c => Math.abs(c - dot))),
    isBetween: cys.some((c, i) => c < dot && dot < (cys[i + 1] ?? -Infinity)) }))(${buildDotCentre(id)}, ${TICKS}.map(t => (r => r.top + r.height / 2)(t.getBoundingClientRect())))`;
// Every other row is coloured, so the plain colour comes from a throwaway tick.
export const buildSameInstantProbe =(fillerId: string, sameId: string) => `((first, second) => {
    const tick = ${TICKS}.find(t => t.dataset.fullTime === ${TICK_LABEL}(first.dataset.instant));
    const ruler = document.getElementById('ruler'); const plain = document.createElement('div'); plain.className = 'tick'; ruler.append(plain);
    const plainColor = getComputedStyle(plain).color; plain.remove();
    return { first: ${BOX}(first), second: ${BOX}(second), tickClasses: tick.className, tickColor: getComputedStyle(tick).color, plainColor };
})(${buildRecordDot(fillerId)}, ${buildRecordDot(sameId)})`;
// `targetExpression` yields the element to hover; the popup is read, then the pointer leaves.
export const buildHoverProbe = (targetExpression: string) => `(async () => {
    const target = ${targetExpression};
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await ${SETTLE};
    const popup = document.getElementById('hover-popup'); const facts = { isVisible: !${IS_HIDDEN}(popup), box: popup === null ? null : ${BOX}(popup), background: popup === null ? '' : getComputedStyle(popup).backgroundColor,
        lines: popup === null ? [] : [...popup.querySelectorAll('.hp-line')].map(l => l.textContent), target: ${BOX}(target),
        targetBackground: getComputedStyle(target).backgroundColor, hasTitle: target.hasAttribute('title') };
    target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); await ${SETTLE};
    return { ...facts, isHiddenAfter: ${IS_HIDDEN}(popup) };
})()`;

export const CUT_FACTS = `({ stripCount: document.querySelectorAll('#jfred-strip').length, cutTicks: ${TICKS}.filter(t => /(^| )cut-/.test(t.className)).length })`;
export const STRIP_FACTS = `(() => {
    const strip = document.getElementById('jfred-strip'); const ticks = ${TICKS}; const stripBox = ${BOX}(strip); const frame = ${BOX}(${PANE});
    const centre = e => { const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
    const entries = [...strip.querySelectorAll('.jnode[data-entry-kind]')].map(n => ({ kind: n.dataset.entryKind, shortHash: n.dataset.shortHash, ...centre(n),
        tickCy: centre(ticks.find(t => t.dataset.fullTime === ${TICK_LABEL}(n.dataset.instant))).cy }));
    const lines = [...strip.querySelectorAll('.jline')].map(l => ({ ...${BOX}(l), style: getComputedStyle(l).borderTopStyle, nodeCx: centre(strip.querySelector('.jnode[data-instant="' + l.dataset.instant + '"]')).cx }));
    const count = name => ticks.filter(t => t.classList.contains(name)).length;
    const spot = [...document.querySelectorAll('.filebox')].map(${BOX}).filter(r => r.left < stripBox.right && r.right > stripBox.left)
        .map(r => ({ x: (Math.max(r.left, stripBox.left) + Math.min(r.right, stripBox.right)) / 2, top: Math.max(r.top, frame.top + 60), bottom: Math.min(r.bottom, frame.bottom) })).find(s => s.bottom - s.top > 4);
    return { strip: stripBox, rulerRight: document.getElementById('ruler').getBoundingClientRect().right, stageLeft: ${STAGE_LEFT},
        headText: strip.querySelector('.jhead span')?.textContent ?? '', deleteCount: strip.querySelectorAll('.jdelete').length, chains: strip.querySelectorAll('.jchain').length, entries, lines,
        marks: Object.fromEntries(['cut-ok', 'cut-no', 'cut-base', 'cut-set'].map(n => [n, count(n)])), untitledNo: ticks.filter(t => t.classList.contains('cut-no') && t.title === '').length,
        isCovering: spot !== undefined && (document.elementFromPoint(spot.x, (spot.top + spot.bottom) / 2)?.closest('#jfred-strip') ?? null) !== null };
})()`;
export const BOTH_FACTS = `(() => {
    const strip = document.getElementById('jfred-strip'); const track = document.getElementById('annotation-track'); const frame = ${BOX}(${PANE});
    const isHit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; const dots =[...track.querySelectorAll('i.anode')].filter(d => d.getBoundingClientRect().width > 0);
    const lines = [...strip.querySelectorAll('.jline')].map(${BOX}); const nodes = [...strip.querySelectorAll('.jnode')].map(${BOX});
    const inView = dots.filter(d => { const r = d.getBoundingClientRect(); return r.top + r.height / 2 > frame.top + 60 && r.bottom < frame.bottom; });
    const minimap = ${BOX}(document.querySelector('.minimap')); const crossed =inView.filter(d => lines.some(l => isHit(${BOX}(d), l))).filter(d => !isHit(${BOX}(d), minimap)); const isOnTop = d => { const r = d.getBoundingClientRect(); return (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('i.anode') ?? null) !== null; };
    return { strip: ${BOX}(strip), track: ${BOX}(track), stageLeft: ${STAGE_LEFT}, trackZ: Number(getComputedStyle(track).zIndex), stripZ: Number(getComputedStyle(strip).zIndex),
        isEveryLineCrossing: lines.length > 0 && lines.every(l => l.left <= ${BOX}(track).left + 1 && l.right >= ${BOX}(track).right), overlaps: dots.filter(d => nodes.some(n => isHit(${BOX}(d), n))).length, crossings: crossed.length,
        isEveryDotOnTop: crossed.length > 0 && crossed.every(isOnTop) };
})()`;
