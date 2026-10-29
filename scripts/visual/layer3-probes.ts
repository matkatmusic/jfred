// Task 343: page expressions that the Layer 3 fixture checks evaluate in the headless page.

export const UTIL_PATH = "src/util.ts";
export const INDEX_PATH = "src/index.ts";
export const DISPATCHER_PATH = "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts";
export const DRAWER_TIMEOUT_MS = 10_000;

export const EDIT_BOX =`document.querySelector('#show-row input[data-kind="edit"]')`;
export const COUNT_EDIT_DOTS = `document.querySelectorAll('i.node.n-edit, i.node.n-read').length`;
export const COUNT_TICKS = `document.querySelectorAll('.ruler .tick').length`;
export const COUNT_EDIT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-edits')).length`;
export const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
export const WATCH_STRIP = `(() => {
    window.__stripShown = false;
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
})()`;

// The first dot of this class inside the path's bubble that passes `test`, as a page expression.
export const buildDotFinder = (path: string, dotClass: string, test = "true") =>
  `([...document.querySelector('.fname[data-path=${JSON.stringify(path)}]').closest('.filebox')
        .querySelectorAll('i.node.${dotClass}')].find(d => ${test}))`;

// A bubble's node rows by class and label, offsets left out.
export const buildRowsProbe = (path: string) =>
  `[...document.querySelector('.fname[data-path=${JSON.stringify(path)}]').closest('.filebox')
        .querySelectorAll('.node, .nlabel')].map(n => n.className + ':' + n.textContent).join('|')`;

// True when a ruler tick starting with `tickText` sits level with the dot's centre.
export const buildRulerMatchProbe = (dot: string, tickText: string) => `(d => {
    const box = d.getBoundingClientRect();
    return [...document.querySelectorAll('.ruler .tick')].some(t => {
        const row = t.getBoundingClientRect();
        return t.textContent.startsWith(${JSON.stringify(tickText)})
            && Math.abs(row.top + row.height / 2 - (box.top + box.height / 2)) <= 2;
    });
})(${dot})`;

export const buildToggleProbe = (dot: string) => `(() => {
    const box = ${EDIT_BOX};
    const shown = () => getComputedStyle(${dot}).display !== 'none';
    box.click();
    const afterUntick = shown();
    box.click();
    const afterTick = shown();
    box.click();
    return { afterUntick, afterTick, afterSecondUntick: shown() };
})()`;

export const buildTokenColour = (token: string) => `(() => {
    const probe = document.createElement('i');
    probe.style.background = 'var(${token})';
    document.querySelector('.viz-root').append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
})()`;
