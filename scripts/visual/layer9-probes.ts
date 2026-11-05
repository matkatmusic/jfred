// Layer 9 browser-side expressions and page-fact types shared by the Layer 9 checks.

import { REQUEST_COUNT } from "./layer7-probes.ts";

export interface PageBox { left: number; right: number; top: number; bottom: number }
export interface EntryFacts { kind: string; shortHash: string | null; parentHash: string | null; instant: string; cx: number; cy: number; tickCy: number }
// export interface TickState { text: string; classes: string; title: string; opacity: number; after: string }
export interface TickState { text: string; fullTime: string; classes: string; title: string; opacity: number; after: string }
export interface StripHeadFacts { stripCount: number; headText: string; deleteCount: number }
export interface StageFacts { stageLeft: number; stripCount: number }
export interface DrawerFacts { isOpen: boolean; text: string; hasButton: boolean }
export interface PendingFacts { entries: number; ticks: number }
export interface MarkFacts { drawer: DrawerFacts; pending: PendingFacts; entries: EntryFacts[]; chains: number; requests: number }
export interface RefusalFacts extends PendingFacts { text: string; isShown: boolean; tickFiles: number }

// Ruler labels in UTC; each is the fixture tick for one case.
export const TICK_LABELS = {
  base: "06-01 09:00:00.000",
  baseNeedsCommit: "06-01 08:50:00.000",
  afterBase: "06-01 09:05:00.000",
  behindTip: "06-01 14:30:00.000",
  atTip: "06-03 10:30:00.000",
  early: "06-03 11:00:00.000",
  late: "06-03 18:20:00.000",
  createdOnly: "06-05 09:00:00.000",
  derivedOnly: "07-21 10:00:00.000",
} as const;
// The tick classes of layer1-cut-paint.ts, whose own list is private.
export const CutClass = { ok: "cut-ok", no: "cut-no", base: "cut-base", set: "cut-set", pending: "cut-pending" } as const;
// Base hash of the canned jfred branch: the commit node at 06-01 09:00.
export const FIXTURE_BASE_HASH = "a1b2c3d4";
export const FOOTNOTE_PREFIX = "reconstructed by JFRED @ ";
export const COMMIT_MODE_LABEL = "Commit mode";
// export const CUT_RULE_PATTERN = "jfred-strip|jnode|jlabel|jchain|jline|jhead|cut-|jfred-message";
export const CUT_RULE_PATTERN = "jfred-strip|jnode|jlabel|jchain|jline|jhead|cut-|jfred-message|sline|ahead|ruler-head|session-toggle|ttime|tcount|s-coloured|tf-[a-z-]+|hover-popup|hp-line";

const SETTLE = `new Promise(resolve => setTimeout(resolve, 200))`;
const TICKS = `document.querySelectorAll('#ruler .tick')`;
const BEACON = `n => !n.classList.contains('n-created') && ['n-commit', 'n-disk', 'n-snap'].some(c => n.classList.contains(c))`;

// export const buildFindTick = (label: string) => `[...${TICKS}].find(t => t.textContent.startsWith(${JSON.stringify(label)}))`;
export const buildFindTick = (label: string) => `[...${TICKS}].find(t => t.dataset.fullTime.startsWith(${JSON.stringify(label)}))`;
export const buildClickTick = (label: string) => `(async () => { ${buildFindTick(label)}.click(); await ${SETTLE}; })()`;
export const buildClickEntry = (shortHash: string) =>
  `(async () => { document.querySelector('#jfred-strip .jnode[data-short-hash=${JSON.stringify(shortHash)}]').click(); await ${SETTLE}; })()`;
export const buildClickById = (id: string) => `(async () => { document.getElementById('${id}').click(); await ${SETTLE}; })()`;
export const DELETE_CLICK = `(async () => { document.querySelector('#jfred-strip .jdelete').click(); await ${SETTLE}; })()`;
export const COMMIT_CLICK = buildClickById("jfred-commit-button");
export const COMMIT_MODE_CLICK = buildClickById("commit-mode");
export const STRIP_COUNT = `document.querySelectorAll('#jfred-strip').length`;
export const STAGE_FACTS = `({ stageLeft: document.getElementById('stage').getBoundingClientRect().left, stripCount: ${STRIP_COUNT} })`;
export const STRIP_HEAD_FACTS = `({ stripCount: ${STRIP_COUNT}, headText: document.querySelector('#jfred-strip .jhead span')?.textContent ?? '',
    deleteCount: document.querySelectorAll('#jfred-strip .jdelete').length })`;
export const MODE_STATE = `({ isCurrent: document.getElementById('commit-mode').classList.contains('current') })`;

// A new .filebox proves the time toggle redrew the stage without a page load.
export const buildTimeToggle = (value: "author" | "committer") => `(() => {
    window.__boxBefore = document.querySelector('.filebox');
    document.getElementById('time-${value}').click();
})()`;
export const TOGGLE_SETTLED = `document.querySelector('.filebox') !== null && document.querySelector('.filebox') !== window.__boxBefore`;

export const ENTRY_FACTS = `(() => {
    const ticks = [...${TICKS}];
    return [...document.querySelectorAll('#jfred-strip .jnode[data-entry-kind]')].map(n => {
        const box = n.getBoundingClientRect();
        const at = n.dataset.instant;
        const tick = ticks.find(t => t.dataset.fullTime.startsWith(at.slice(5, 10) + ' ' + at.slice(11, 23)));
        const tickBox = tick ? tick.getBoundingClientRect() : null;
        return { kind: n.dataset.entryKind, shortHash: n.dataset.shortHash ?? null, parentHash: n.dataset.parentHash ?? null, instant: at,
            cx: box.left + box.width / 2, cy: box.top + box.height / 2, tickCy: tickBox ? tickBox.top + tickBox.height / 2 : -1 };
    });
})()`;
export const CHAIN_COUNT = `document.querySelectorAll('#jfred-strip .jchain').length`;
export const PENDING_FACTS = `({ entries: document.querySelectorAll('#jfred-strip .jnode.j-pending').length, ticks: document.querySelectorAll('#ruler .tick.cut-pending').length })`;
export const TICKFILES_COUNT = `document.querySelectorAll('#ruler .tickfiles').length`;
export const TICK_STATES = `[...${TICKS}].map(t => ({ text: t.textContent, fullTime: t.dataset.fullTime ?? '', classes: t.className, title: t.title,
    opacity: Number(getComputedStyle(t).opacity), after: getComputedStyle(t, '::after').content }))`;
export const DRAWER_FACTS = `(() => {
    const pre = document.querySelector('#dbody pre');
    return { isOpen: document.getElementById('drawer').classList.contains('open'), text: pre ? pre.textContent : '',
        hasButton: document.getElementById('jfred-commit-button') !== null };
})()`;
export const MARK_FACTS = `({ drawer: ${DRAWER_FACTS}, pending: ${PENDING_FACTS}, entries: ${ENTRY_FACTS}, chains: ${CHAIN_COUNT}, requests: ${REQUEST_COUNT} })`;

// Hides the toast first, so a shown toast came from this click.
export const buildRefusalClick = (label: string) => `(() => {
    const toast = document.getElementById('dtoast');
    toast.hidden = true;
    toast.textContent = '';
    ${buildFindTick(label)}.click();
    return { text: toast.textContent, isShown: !toast.hidden && getComputedStyle(toast).display !== 'none', tickFiles: ${TICKFILES_COUNT},
        entries: document.querySelectorAll('#jfred-strip .jnode.j-pending').length, ticks: document.querySelectorAll('#ruler .tick.cut-pending').length };
})()`;

export const buildSnapLines = (instant: string) =>
  `import('/app/layer1-jfred-message.js').then(module => module.listSnapLines(Date.parse(${JSON.stringify(instant)})))`;
// Independent count: distinct beacon-node instants between two marks, read from the stage.
export const buildBeaconInstantCount = (fromInstant: string, toInstant: string) => `(() => {
    const isBeacon = ${BEACON};
    const instants = new Set([...document.querySelectorAll('#stage .node')].filter(isBeacon).map(n => Date.parse(n.dataset.instant)));
    return [...instants].filter(ms => ms > Date.parse(${JSON.stringify(fromInstant)}) && ms < Date.parse(${JSON.stringify(toInstant)})).length;
})()`;

export const BUTTON_FACTS = `(() => {
    const button = document.getElementById('commit-mode');
    return { text: button.textContent, previousId: button.previousElementSibling.id, isHidden: button.hidden,
        display: getComputedStyle(button).display, isSettingsOpen: document.querySelector('.project-settings-open') !== null,
        isInShowRow: [...document.querySelectorAll('#show-row *')].some(e => e.textContent.trim() === '${COMMIT_MODE_LABEL}') };
})()`;

// The track exists only while the session column is on, so its edges are null when it is off.
// export const STRIP_LAYOUT_FACTS = `(() => {
//     const box = id => document.getElementById(id).getBoundingClientRect();
//     return { stripLeft: box('jfred-strip').left, stripRight: box('jfred-strip').right, trackLeft: box('annotation-track').left,
//         trackRight: box('annotation-track').right, rulerRight: box('ruler').right, paneLeft: box('timelines').left,
//         position: getComputedStyle(document.getElementById('jfred-strip')).position,
//         firstBoxLeft: document.querySelector('.filebox').getBoundingClientRect().left };
// })()`;
export const STRIP_LAYOUT_FACTS = `(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    const track = document.getElementById('annotation-track');
    return { stripLeft: box('jfred-strip').left, stripRight: box('jfred-strip').right, trackLeft: track ? box('annotation-track').left : null,
        trackRight: track ? box('annotation-track').right : null, rulerRight: box('ruler').right, paneLeft: box('timelines').left,
        position: getComputedStyle(document.getElementById('jfred-strip')).position,
        firstBoxLeft: document.querySelector('.filebox').getBoundingClientRect().left };
})()`;
export const OVERLAP_FACTS = `(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const strip = document.getElementById('jfred-strip');
    const button = strip.querySelector('.jdelete');
    const track = document.getElementById('annotation-track');
    const centreOf = line => { const node = strip.querySelector('.jnode[data-instant="' + line.dataset.instant + '"]'); const r = node.getBoundingClientRect(); return r.left + r.width / 2; };
    return { strip: box(strip), ruler: box(document.getElementById('ruler')), track: track ? box(track) : null, labels: [...strip.querySelectorAll('.jlabel')].map(box),
        button: { ...box(button), isClipped: button.scrollWidth > button.clientWidth },
        lines: [...strip.querySelectorAll('.jline')].map(line => ({ ...box(line), nodeCx: centreOf(line) })) };
})()`;

// The --page skip is off: the theme token selector is plain .viz-root again.
// export const CUT_RULE_TEXTS = `[...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
//     .filter(rule => /(${CUT_RULE_PATTERN})/.test(rule.selectorText ?? '')).filter(rule => rule.style.getPropertyValue('--page') === '')
//     .map(rule => rule.style.cssText)`;
export const CUT_RULE_TEXTS = `[...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    .filter(rule => /(${CUT_RULE_PATTERN})/.test(rule.selectorText ?? '')).map(rule => rule.style.cssText)`;
export const SLACK_FACTS = `(() => {
    const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const stage = document.getElementById('stage');
    const strip = document.getElementById('jfred-strip');
    const parent = strip.parentNode;
    const next = strip.nextSibling;
    const marginWith = getComputedStyle(stage).marginLeft;
    strip.remove();
    const marginWithout = getComputedStyle(stage).marginLeft;
    parent.insertBefore(strip, next);
    return { stripRules: rules.filter(rule => rule.selectorText === '.jfred-strip + .stage').length, marginWith, marginWithout };
})()`;
