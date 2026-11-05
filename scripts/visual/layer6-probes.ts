// Layer 6 browser-side expressions: node ids, style probes and popup probes shared by the Layer 6 checks.

import { FIXTURE_RUN_ID } from "../../src/viewer_api_layer6_fixture_blocked_runs.ts";
import { buildBubbleSelector } from "./mockup-checks.ts";

export const PENDING_ID = "toolu_fixture_l6_pre";
export const VERIFIED_ID = "toolu_fixture_l6_verified";
export const DERIVED_ID = "toolu_fixture_l6_derived";
export const MISMATCH_ID = "toolu_fixture_l6_mismatch";
export const ORIGINAL_FAILED_ID = "toolu_fixture_l6_original_failed";
export const INJECTED_ID = "toolu_fixture_l6_injected";
export const NEVER_PROVABLE_ID = "toolu_fixture_l6_never_provable";
export const BLOCKER_ID = FIXTURE_RUN_ID.blocker;
export const BLOCKED_ID = FIXTURE_RUN_ID.blocked;
export const SLOW_ID = FIXTURE_RUN_ID.slow;
export const REPLAY_MISMATCH_ID = FIXTURE_RUN_ID.replayMismatch;
export const SKIP_AFTER_ID = FIXTURE_RUN_ID.skipAfter;
export const SKIP_FAILED_ID = FIXTURE_RUN_ID.skipFailed;
export const SKIP_BASH_ID = FIXTURE_RUN_ID.skipBash;
export const CRASH_BLOCKER_ID = FIXTURE_RUN_ID.crashBlocker;
export const CRASH_BLOCKED_ID = FIXTURE_RUN_ID.crashBlocked;
export const REPLAY_NOT_REPLAYED_ID = FIXTURE_RUN_ID.replayNotReplayed;

export const RESOURCE_NAMES = `performance.getEntriesByType('resource').map(e => e.name)`;
export const COUNT_CONSOLE_BUTTONS = `document.querySelectorAll('.run-console-open').length`;
export const COUNT_CONSOLES = `document.querySelectorAll('#run-console').length`;
export const POPUP_TEXT = `document.getElementById('run-console').textContent`;
export const README_BUBBLE = `document.querySelector(${JSON.stringify(buildBubbleSelector("README.md"))})`;
export const buildNodeExpression = (toolUseId: string) => `document.querySelector('i.node.n-script[data-tool-use-id="${toolUseId}"]')`;
export const buildDotClasses = (toolUseId: string) => `${buildNodeExpression(toolUseId)}.className`;
export const buildScrollToDot = (toolUseId: string) => `${buildNodeExpression(toolUseId)}.scrollIntoView({ block: 'center', inline: 'center' })`;
export const buildDotInView = (toolUseId: string) => `(d => {
    const r = d.getBoundingClientRect();
    const p = document.getElementById('timelines').getBoundingClientRect();
    return r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom;
})(${buildNodeExpression(toolUseId)})`;

// The page's fetch and native dialogs are wrapped so the checks can read what the page sent.
export const PAGE_SPY_INSTALL = `(() => {
    window.__fetchLog = [];
    window.__dialogCount = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        window.__fetchLog.push({ path: url.pathname, body: String(init?.body ?? '') });
        return original(input, init);
    };
    for (const name of ['alert', 'confirm', 'prompt']) window[name] = () => { window.__dialogCount += 1; return false; };
})()`;
export const READ_FETCH_LOG = `window.__fetchLog`;
export const READ_DIALOG_COUNT = `window.__dialogCount`;
export const buildRunPostProbe = (toolUseId: string) =>
  `window.__fetchLog.some(e => e.path === '/api/layer1-script-run' && JSON.parse(e.body).toolUseId === '${toolUseId}')`;

const POST_JSON = `method: 'POST', headers: { 'Content-Type': 'application/json' }`;
export const buildNeedsProbe = (toolUseId: string) => `fetch('/api/layer1-script-needs' + location.search,
    { ${POST_JSON}, body: JSON.stringify({ toolUseId: '${toolUseId}' }) }).then(r => r.json()).then(reply => reply.needs.map(n => n.toolUseId))`;
export const CLEAR_RESULTS_PROBE = `fetch('/api/layer1-clear-results', { ${POST_JSON}, body: '{}' }).then(r => r.status)`;

export const COUNT_CONSENT_DIALOGS = `document.querySelectorAll('.run-consent').length`;
export const CONSENT_FACTS = `(() => {
    const dialog = document.querySelector('.run-consent');
    return { count: ${COUNT_CONSENT_DIALOGS}, text: dialog?.textContent ?? '', insideVizRoot: dialog?.closest('.viz-root') != null };
})()`;
export const CLICK_RUN_SCRIPTS = `document.querySelector('.run-consent .consent-run').click()`;
export const HIDE_CONSENT = `document.querySelector('.run-consent').style.display = 'none'`;
export const SHOW_CONSENT = `document.querySelector('.run-consent').style.display = ''`;

export interface NodeFacts {
  id: string; classes: string; width: number; height: number;
  borderStyle: string; borderColor: string; borderWidth: string;
  outlineStyle: string; outlineColor: string; outlineWidth: string; backgroundImage: string;
}

export const README_NODE_FACTS = `[...${README_BUBBLE}.querySelectorAll('i.node.n-script')].map(n => {
    const s = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return { id: n.dataset.toolUseId, classes: n.className, width: r.width, height: r.height,
        borderStyle: s.borderTopStyle, borderColor: s.borderTopColor, borderWidth: s.borderTopWidth,
        outlineStyle: s.outlineStyle, outlineColor: s.outlineColor, outlineWidth: s.outlineWidth, backgroundImage: s.backgroundImage };
})`;

export const NEVER_PROVABLE_RULE_COUNT = `[...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    .filter(rule => rule.selectorText?.includes('.never-provable')).length`;
export const SHOW_BOX_KINDS = `[...document.querySelectorAll('#show-row input[data-kind]')].map(i => i.dataset.kind)`;

export interface PopupFacts {
  hidden: boolean; width: number; height: number; popupRect: number[]; stageRect: number[]; drawerRect: number[]; insideDrawer: boolean; drawerOpen: boolean; position: string;
  insideStagewrap: boolean; overlapsTimelines: boolean;
  preCount: number; preWhiteSpace: string; preText: string; noteTexts: string[];
  cancelButtons: number; cancelClass: string; cancelDisabled: boolean; cancelBorderColor: string; cancelDecoration: string;
  terminalClasses: string[]; terminalColours: string[];
}

export const POPUP_FACTS = `(() => {
    const popup = document.getElementById('run-console');
    const box = popup.getBoundingClientRect();
    const wrap = document.getElementById('stagewrap').getBoundingClientRect();
    const lines = document.getElementById('timelines').getBoundingClientRect();
    const pre = popup.querySelector('pre.console-pre');
    const button = popup.querySelector('.cancel-btn');
    const buttonStyle = getComputedStyle(button);
    return {
        hidden: popup.hidden, width: box.width, height: box.height,
        popupRect: [box.left, box.top, box.right, box.bottom], stageRect: [wrap.left, wrap.top, wrap.right, wrap.bottom],
        drawerRect: (d => [d.left, d.top, d.right, d.bottom])(document.getElementById('drawer').getBoundingClientRect()),
        insideDrawer: popup.closest('#drawer') !== null, drawerOpen: document.getElementById('drawer').classList.contains('open'),
        position: getComputedStyle(popup).position,
        insideStagewrap: box.left >= wrap.left && box.right <= wrap.right && box.top >= wrap.top && box.bottom <= wrap.bottom,
        overlapsTimelines: box.left < lines.right && box.right > lines.left && box.top < lines.bottom && box.bottom > lines.top,
        preCount: popup.querySelectorAll('pre.console-pre').length, preWhiteSpace: getComputedStyle(pre).whiteSpace, preText: pre.textContent,
        noteTexts: [...popup.querySelectorAll('.run-console-note')].map(n => n.textContent),
        cancelButtons: popup.querySelectorAll('.cancel-btn').length, cancelClass: button.className, cancelDisabled: button.disabled,
        cancelBorderColor: buttonStyle.borderTopColor, cancelDecoration: buttonStyle.textDecorationLine,
        terminalClasses: [...popup.querySelectorAll('.terminal-block')].map(b => [...b.classList].filter(c => c.startsWith('term-')).join('')),
        terminalColours: [...popup.querySelectorAll('.terminal-block .terminal-title')].map(t => getComputedStyle(t).color) };
})()`;

export const CLICK_OPEN_BUTTON = `document.querySelector('.run-console-open').click()`;
export const CLICK_CANCEL = `document.querySelector('#run-console .cancel-btn').click()`;
export const CLICK_CLOSE = `document.querySelector('#run-console .run-console-close').click()`;
export const CLOSE_LABEL = `document.querySelector('#run-console .run-console-close').textContent`;
export const RESET_DRAWER = `(document.getElementById('dbody').replaceChildren(), document.getElementById('drawer').classList.remove('open'))`;
export const OPEN_BUTTON_PRESENT = `document.querySelector('.run-console-open') !== null`;
export const CONSOLE_FINISHED = `document.querySelector('#run-console .cancel-btn.btn-idle') !== null`;

export interface ButtonFacts { count: number; text: string | undefined; insideDrawer: boolean }

export const BUTTON_FACTS = `({
    count: ${COUNT_CONSOLE_BUTTONS}, text: document.querySelector('.run-console-open')?.textContent,
    insideDrawer: document.querySelector('.run-console-open')?.closest('#drawer') !== null })`;

// Replaced: one popup now holds one terminal block, so the title colour is read from the popup facts.
// export const buildTitleColour = (termClass: string) => `getComputedStyle(document.querySelector('.${termClass} .terminal-title')).color`;
