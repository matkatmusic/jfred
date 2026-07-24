// Shared browser-environment setup for webapp DOM tests (task 122). node --test runs in plain
// Node, so the happy-dom window plus the vendor-script globals (xterm's Terminal/FitAddon) are
// installed here BEFORE any webapp module is dynamically imported.

import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

// The minimal xterm surface app-console.ts exercises (ensureProgressTerminal, logProgress,
// fitProgressColumns). Every method is a no-op; writeln invokes its completion callback so the
// scroll-in-callback pattern still runs.
class FakeXtermTerminal {
    open(_parent: unknown): void {}
    writeln(_text: string, done?: () => void): void {
        done?.();
    }
    scrollToBottom(): void {}
    clear(): void {}
    loadAddon(_addon: unknown): void {}
    onSelectionChange(_callback: () => void): void {}
    getSelection(): string {
        return "";
    }
    registerLinkProvider(_provider: unknown): void {}
    resize(_columns: number, _rows: number): void {}
}

// The vendor addon-fit script exposes a namespace object { FitAddon: class }; proposeDimensions
// returning undefined makes fitProgressColumns a no-op.
class FakeXtermFitAddon {
    fit(): void {}
    proposeDimensions(): undefined {
        return undefined;
    }
}

// ensureProgressTerminal only observes the console element to re-fit columns — the observer's
// behavior is never under test, so a deterministic no-op fake beats happy-dom's implementation.
class FakeResizeObserver {
    observe(_target: unknown): void {}
    unobserve(_target: unknown): void {}
    disconnect(): void {}
}

// Extract the real header/console markup so every id the webapp looks up exists with its real
// attributes (including the popovers' initial `hidden`). The page under test is the preserved
// pre-redesign webapp_old.html (task 204 renamed index.html; the layered page will claim
// index.html later — task 205).
function readIndexHtmlBodyMarkup(): string {
    const html = readFileSync(new URL("../webapp/webapp_old.html", import.meta.url), "utf8");
    return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Build a fresh happy-dom window, publish it (plus the xterm fakes) as globals, and load the
// real index.html body. Safe to call once per test: each call replaces every global, and stale
// listeners from a previous window resolve ids against a document no test looks at again.
export function setupWebappDom(): void {
    // Port 7343 matches the real viewer server default so location.origin looks authentic.
    const browserWindow = new Window({ url: "http://localhost:7343/" });
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        location: browserWindow.location,
        sessionStorage: browserWindow.sessionStorage,
        // views/diff-vs-base.ts reads its stored diff mode from localStorage at module scope.
        localStorage: browserWindow.localStorage,
        getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
        HTMLElement: browserWindow.HTMLElement,
        HTMLInputElement: browserWindow.HTMLInputElement,
        HTMLButtonElement: browserWindow.HTMLButtonElement,
        ResizeObserver: FakeResizeObserver,
        Terminal: FakeXtermTerminal,
        FitAddon: { FitAddon: FakeXtermFitAddon },
        // The find widget's CSS Custom Highlight API (task 127): happy-dom has no CSS global;
        // a Map covers the set/delete calls resetDetailsFind and paintMatches make.
        CSS: { highlights: new Map() },
    });
    browserWindow.document.body.innerHTML = readIndexHtmlBodyMarkup();
}

// A minimal Response-like object covering exactly what fetchLogged reads: ok/status/json/text.
function respondJson(payload: unknown, ok: boolean, status: number): Response {
    return {
        ok,
        status,
        json: async () => payload,
        text: async () => (ok ? "" : "pathname not stubbed by stubFetchRoutes"),
    } as unknown as Response;
}

// The stubbed fetch: canned JSON payloads keyed by request pathname. Query strings are
// deliberately ignored — the blob-presence probes vary only in their query. Unknown pathnames
// answer 404 with a body naming the gap so a missing stub fails loudly instead of hanging.
function buildStubbedFetch(routesByPathname: Record<string, unknown>): (url: unknown) => Promise<Response> {
    return async (url: unknown): Promise<Response> => {
        const { pathname } = new URL(String(url), "http://localhost:7343");
        if (pathname in routesByPathname) {
            return respondJson(routesByPathname[pathname], true, 200);
        }
        return respondJson({}, false, 404);
    };
}

// Replace global fetch for the duration of a test with the canned-route stub above.
export function stubFetchRoutes(routesByPathname: Record<string, unknown>): void {
    Object.assign(globalThis, { fetch: buildStubbedFetch(routesByPathname) });
}

// Let fire-and-forget promise chains (void populateProjectsMenu, the presence-probe
// Promise.all) settle: three macrotask turns cover fetch -> json -> completion handler.
export async function flushAsyncWork(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}
