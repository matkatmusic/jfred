// Layer 4 browser-side expressions: selectors, counters and probe builders shared by the Layer 4 checks.

export const PYTHON_RUN_ID = "toolu_fixture_py_rewrite";
const BASH_RUN_ID = "toolu_fixture_sh_inline";

export const SCRIPT_BOX = `document.querySelector('#show-row input[data-kind="script-run"]')`;
export const EDIT_BOX = `document.querySelector('#show-row input[data-kind="edit"]')`;
export const SCRIPT_DOTS = `document.querySelectorAll('i.node.n-script')`;
export const COUNT_SCRIPT_DOTS = `${SCRIPT_DOTS}.length`;
export const COUNT_EDIT_DOTS = `document.querySelectorAll('i.node.n-edit, i.node.n-read').length`;
export const COUNT_TICKS = `document.querySelectorAll('.ruler .tick').length`;
export const COUNT_SCRIPT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-script-runs')).length`;
export const COUNT_EDIT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-edits')).length`;
export const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
export const WATCH_STRIP = `(() => {
    window.__stripShown = false;
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
})()`;

export const pythonDots = `[...document.querySelectorAll('i.node.n-script[data-tool-use-id="${PYTHON_RUN_ID}"]')]`;
export const pythonLabels = `[...document.querySelectorAll('.nlabel.n-script[data-tool-use-id="${PYTHON_RUN_ID}"]')]`;
export const bashDot = `document.querySelector('i.node.n-script[data-tool-use-id="${BASH_RUN_ID}"]')`;
export const bashLabel = `document.querySelector('.nlabel.n-script[data-tool-use-id="${BASH_RUN_ID}"]')`;
export const connector = `document.querySelector('#stage .script-connector[data-tool-use-id="${PYTHON_RUN_ID}"]')`;
export const buildBubblePathExpression = (dot: string) => `${dot}.closest('.filebox').querySelector('.fname[data-path]').dataset.path`;

// True when some ruler tick sits level with the dot's centre.
export const buildRulerMatchProbe = (dot: string) => `(d => {
    const box = d.getBoundingClientRect();
    return [...document.querySelectorAll('.ruler .tick')].some(t => {
        const row = t.getBoundingClientRect();
        return Math.abs(row.top + row.height / 2 - (box.top + box.height / 2)) <= 2;
    });
})(${dot})`;

// Reads dot, label and connector visibility after each of three box clicks.
export const buildToggleProbe = () => `(() => {
    const box = ${SCRIPT_BOX};
    const parts = () => [...${SCRIPT_DOTS}, ...document.querySelectorAll('.nlabel.n-script, .script-connector')];
    const state = () => { const seen = parts().map(p => getComputedStyle(p).visibility); return { count: seen.length, visible: seen.every(v => v === 'visible'), hidden: seen.every(v => v === 'hidden') }; };
    box.click();
    const afterUntick = state();
    box.click();
    const afterTick = state();
    box.click();
    const afterSecondUntick = state();
    box.click();
    return { afterUntick, afterTick, afterSecondUntick, endsTicked: box.checked };
})()`;
