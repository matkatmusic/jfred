// Layer 6 browser-side expressions: node ids, style probes and popup probes shared by the Layer 6 checks.

import { buildBubbleSelector } from "./mockup-checks.ts";

export const PENDING_ID = "toolu_fixture_l6_pre";
export const VERIFIED_ID = "toolu_fixture_l6_verified";
export const DERIVED_ID = "toolu_fixture_l6_derived";
export const MISMATCH_ID = "toolu_fixture_l6_mismatch";
export const ORIGINAL_FAILED_ID = "toolu_fixture_l6_original_failed";
export const INJECTED_ID = "toolu_fixture_l6_injected";
export const NEVER_PROVABLE_ID = "toolu_fixture_l6_never_provable";

export const RESOURCE_NAMES = `performance.getEntriesByType('resource').map(e => e.name)`;
export const COUNT_CONSOLE_BUTTONS = `document.querySelectorAll('.run-console-open').length`;
export const COUNT_CONSOLES = `document.querySelectorAll('#run-console').length`;
export const POPUP_TEXT = `document.getElementById('run-console').textContent`;
export const README_BUBBLE = `document.querySelector(${JSON.stringify(buildBubbleSelector("README.md"))})`;
export const buildNodeExpression = (toolUseId: string) => `document.querySelector('i.node.n-script[data-tool-use-id="${toolUseId}"]')`;

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
  preCount: number; preWhiteSpace: string; captionCount: number; captionStyle: string; stateCaptionCount: number;
  idleDisabled: boolean; liveDisabled: boolean; cancelledDisabled: boolean;
  liveBorderColor: string; cancelledDecoration: string; cancelButtons: number;
  terminalClasses: string[]; terminalColours: string[];
}

export const POPUP_FACTS = `(() => {
    const popup = document.getElementById('run-console');
    const box = popup.getBoundingClientRect();
    const wrap = document.getElementById('stagewrap').getBoundingClientRect();
    const lines = document.getElementById('timelines').getBoundingClientRect();
    const cancelButton = name => popup.querySelector('.cancel-btn.' + name);
    const pre = popup.querySelector('pre.console-pre');
    const caption = popup.querySelector('.console-caption');
    return {
        hidden: popup.hidden, width: box.width, height: box.height,
        popupRect: [box.left, box.top, box.right, box.bottom], stageRect: [wrap.left, wrap.top, wrap.right, wrap.bottom],
        drawerRect: (d => [d.left, d.top, d.right, d.bottom])(document.getElementById('drawer').getBoundingClientRect()),
        insideDrawer: popup.closest('#drawer') !== null, drawerOpen: document.getElementById('drawer').classList.contains('open'),
        position: getComputedStyle(popup).position,
        insideStagewrap: box.left >= wrap.left && box.right <= wrap.right && box.top >= wrap.top && box.bottom <= wrap.bottom,
        overlapsTimelines: box.left < lines.right && box.right > lines.left && box.top < lines.bottom && box.bottom > lines.top,
        preCount: popup.querySelectorAll('pre.console-pre').length, preWhiteSpace: getComputedStyle(pre).whiteSpace,
        captionCount: popup.querySelectorAll('.console-caption').length, captionStyle: getComputedStyle(caption).fontStyle,
        stateCaptionCount: popup.querySelectorAll('.state-caption').length,
        cancelButtons: popup.querySelectorAll('.cancel-btn').length,
        idleDisabled: cancelButton('btn-idle').disabled, liveDisabled: cancelButton('btn-live').disabled,
        cancelledDisabled: cancelButton('btn-cancelled').disabled,
        liveBorderColor: getComputedStyle(cancelButton('btn-live')).borderTopColor,
        cancelledDecoration: getComputedStyle(cancelButton('btn-cancelled')).textDecorationLine,
        terminalClasses: [...popup.querySelectorAll('.terminal-block')].map(b => [...b.classList].filter(c => c.startsWith('term-')).join('')),
        terminalColours: [...popup.querySelectorAll('.terminal-block .terminal-title')].map(t => getComputedStyle(t).color) };
})()`;

export const CLICK_OPEN_BUTTON = `document.querySelector('.run-console-open').click()`;
export const CLICK_CANCEL = `document.querySelector('#run-console .btn-live').click()`;
export const CLICK_CLOSE = `document.querySelector('#run-console .run-console-close').click()`;
export const CLOSE_LABEL = `document.querySelector('#run-console .run-console-close').textContent`;

export interface ButtonFacts { count: number; text: string | undefined; insideDrawer: boolean }

export const BUTTON_FACTS = `({
    count: ${COUNT_CONSOLE_BUTTONS}, text: document.querySelector('.run-console-open')?.textContent,
    insideDrawer: document.querySelector('.run-console-open')?.closest('#drawer') !== null })`;

export const buildTitleColour = (termClass: string) => `getComputedStyle(document.querySelector('.${termClass} .terminal-title')).color`;
