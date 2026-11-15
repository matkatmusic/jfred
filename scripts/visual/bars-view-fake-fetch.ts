// Swaps window.fetch in the page: fake inverse repos (held stream, line by line) and fake inverse state.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";

const PAUSE_AFTER_RELEASE_MS = 50;

const INSTALL_GATE_STATE = `(() => {
    window.__barsReposRequests = 0;
    window.__barsStateRequests = 0;
    window.__barsFakeMode = 'ok';
    window.__barsErrorLines = [];
    window.__barsStreamGate = { lines: [], sent: 0, allowed: 0, wake: null,
        releaseNextLine() { this.allowed += 1; if (this.wake) this.wake(); } };
    return true;
})()`;

const INSTALL_OBSERVERS = `(() => {
    window.__barsStatusLog = [];
    window.__barsLoadingLog = [];
    window.__barsTickClicks = 0;
    const status = document.getElementById('barsStatusLine');
    new MutationObserver(() => window.__barsStatusLog.push(status.textContent.replace(/^==>\\s*/, '')))
        .observe(status, { childList: true });
    const ruler = document.getElementById('timelineRulerComponent');
    new MutationObserver(() => window.__barsLoadingLog.push(ruler.classList.contains('barsRulerLoading')))
        .observe(ruler, { attributes: true, attributeFilter: ['class'] });
    ruler.addEventListener('click', (event) => { if (event.target.closest('.tick')) window.__barsTickClicks += 1; }, true);
    return true;
})()`;

const INSTALL_FETCH = `(() => {
    const realFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const gate = window.__barsStreamGate;
    const buildGatedBody = () => new ReadableStream({ async pull(controller) {
        while (gate.sent >= gate.allowed) await new Promise((resolve) => { gate.wake = resolve; });
        controller.enqueue(encoder.encode(gate.lines[gate.sent] + '\\n'));
        gate.sent += 1;
        if (gate.sent === gate.lines.length) controller.close();
    } });
    const answerRepos = () => {
        window.__barsReposRequests += 1;
        if (window.__barsFakeMode === 'error') return new Response(window.__barsErrorLines.join('\\n') + '\\n');
        return new Response(buildGatedBody());
    };
    const answerState = (url) => {
        window.__barsStateRequests += 1;
        const text = window.__barsStateRequests % 2 === 0 ? 'first text\\n' : 'second text\\n';
        const reply = { file: url.searchParams.get('file'), commit: null, text };
        return new Response(JSON.stringify(reply), { headers: { 'Content-Type': 'application/json' } });
    };
    window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)), location.href);
        if (url.pathname === '/api/layer1-inverse-repos') return Promise.resolve(answerRepos());
        if (url.pathname === '/api/layer1-inverse-state') return Promise.resolve(answerState(url));
        return realFetch(input, init);
    };
    return true;
})()`;

export async function installFakeFetch(page: HeadlessPage, errorLines: string[]): Promise<void> {
    await page.evaluate(INSTALL_GATE_STATE);
    await page.evaluate(`(window.__barsErrorLines = ${JSON.stringify(errorLines)}, true)`);
    await page.evaluate(INSTALL_OBSERVERS);
    await page.evaluate(INSTALL_FETCH);
}

// The next repos request holds every line back until releaseStreamLines lets it go.
export async function armStreamGate(page: HeadlessPage, lines: string[]): Promise<void> {
    await page.evaluate(`(Object.assign(window.__barsStreamGate, { lines: ${JSON.stringify(lines)}, sent: 0, allowed: 0, wake: null }),
        window.__barsFakeMode = 'ok', window.__barsReposRequests = 0, window.__barsStatusLog = [], true)`);
}

export async function releaseStreamLines(page: HeadlessPage, lineCount: number): Promise<void> {
    for (let released = 0; released < lineCount; released++) {
        await page.evaluate(`(window.__barsStreamGate.releaseNextLine(), true)`);
        await waitMilliseconds(PAUSE_AFTER_RELEASE_MS);
    }
}
