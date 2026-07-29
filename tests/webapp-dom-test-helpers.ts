// Plain Node under node --test: install happy-dom window and vendor globals before webapp imports.

import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

// Captured before any test replaces fetch; forwarding through a later stub would return canned 404s.
const NATIVE_FETCH = globalThis.fetch;

// writeln must invoke its completion callback so app-console's scroll-in-callback pattern still runs.
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

// proposeDimensions returning undefined makes fitProgressColumns a no-op.
class FakeXtermFitAddon {
    fit(): void {}
    proposeDimensions(): undefined {
        return undefined;
    }
}

// Observer behavior is never under test, so a deterministic no-op beats happy-dom's implementation.
class FakeResizeObserver {
    observe(_target: unknown): void {}
    unobserve(_target: unknown): void {}
    disconnect(): void {}
}

// Uses the real markup so every id exists with its real attributes (including popovers' `hidden`).
function readIndexHtmlBodyMarkup(): string {
    const html = readFileSync(new URL("../webapp/webapp_old.html", import.meta.url), "utf8");
    return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Safe to call once per test: each call replaces every global, so stale listeners resolve against an abandoned document.
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
        // Task 127: happy-dom has no CSS global; a Map covers the highlight set/delete calls.
        CSS: { highlights: new Map() },
    });
    browserWindow.document.body.innerHTML = readIndexHtmlBodyMarkup();
}

// The layered page's body markup (task 205): index.html is the new main page.
function readLayeredHtmlBodyMarkup(): string {
    const html = readFileSync(new URL("../webapp/index.html", import.meta.url), "utf8");
    return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Fresh happy-dom window for the layered page (task 205), minus fakes the skeleton never uses.
export function setupLayeredDom(): void {
    const browserWindow = new Window({ url: "http://localhost:7343/" });
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        location: browserWindow.location,
        sessionStorage: browserWindow.sessionStorage,
        localStorage: browserWindow.localStorage,
        HTMLElement: browserWindow.HTMLElement,
        HTMLButtonElement: browserWindow.HTMLButtonElement,
    });
    browserWindow.document.body.innerHTML = readLayeredHtmlBodyMarkup();
}

// The Layer 1 View page's body markup (task 237, spec S18).
function readLayer1HtmlBodyMarkup(): string {
    const html = readFileSync(new URL("../webapp/layer1.html", import.meta.url), "utf8");
    return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Fresh happy-dom window for the Layer 1 page (task 237); `search` seeds the URL query.
export function setupLayer1Dom(search: string = ""): void {
    const browserWindow = new Window({ url: `http://localhost:7343/app/layer1.html${search}` });
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        location: browserWindow.location,
        history: browserWindow.history,
        HTMLElement: browserWindow.HTMLElement,
        HTMLInputElement: browserWindow.HTMLInputElement,
        HTMLButtonElement: browserWindow.HTMLButtonElement,
        // Task 309: the chunked stage render awaits a painted frame between chunks.
        requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
    });
    browserWindow.document.body.innerHTML = readLayer1HtmlBodyMarkup();
}

// The debug page's body markup (task 183): the per-file debug viewer skeleton.
function readDebugHtmlBodyMarkup(): string {
    const html = readFileSync(new URL("../webapp/debug.html", import.meta.url), "utf8");
    return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Fresh happy-dom window for the debug page (task 183); `search` seeds deep-link queries.
export function setupDebugDom(search: string = ""): void {
    const browserWindow = new Window({ url: `http://localhost:7343/app/debug.html${search}` });
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        location: browserWindow.location,
        sessionStorage: browserWindow.sessionStorage,
        localStorage: browserWindow.localStorage,
        HTMLElement: browserWindow.HTMLElement,
        HTMLButtonElement: browserWindow.HTMLButtonElement,
    });
    browserWindow.document.body.innerHTML = readDebugHtmlBodyMarkup();
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

// The stubbed fetch: canned JSON keyed by pathname, ignoring query strings; unknown pathnames answer 404 naming the gap loudly.
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

// A Response streaming real NDJSON for pages reading progress (Layer 1's `?progress=1` path).
function enqueueOnceThenClose(encoded: Uint8Array): (controller: ReadableStreamDefaultController) => void {
    return (controller) => {
        controller.enqueue(encoded);
        controller.close();
    };
}

function respondNdjsonStream(lines: unknown[]): Response {
    const encoded = new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    const body = new ReadableStream({ start: enqueueOnceThenClose(encoded) });
    return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

function buildStubbedStreamFetch(pathname: string, lines: unknown[]): (url: unknown) => Promise<Response> {
    return async (url: unknown): Promise<Response> => {
        const matched = new URL(String(url), "http://localhost:7343").pathname === pathname;
        return matched ? respondNdjsonStream(lines) : respondJson({}, false, 404);
    };
}

// Replace global fetch with one answering `pathname` with a canned NDJSON stream, ignoring query strings like stubFetchRoutes.
export function stubStreamRoute(pathname: string, lines: unknown[]): void {
    Object.assign(globalThis, { fetch: buildStubbedStreamFetch(pathname, lines) });
}

// Task 238 (spec S18): route relative fetches to a live server; node fetch rejects relative urls.
export function forwardFetchToOrigin(origin: string): void {
    Object.assign(globalThis, {
        fetch: (url: unknown, options?: RequestInit): Promise<Response> =>
            NATIVE_FETCH(new URL(String(url), origin), options),
    });
}

// Let fire-and-forget promise chains settle: three macrotask turns cover fetch, json, and completion handler steps.
export async function flushAsyncWork(): Promise<void> {
    for (let turn = 0; turn < 3; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}
