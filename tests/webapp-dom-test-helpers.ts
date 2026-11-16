// Plain Node under node --test: install happy-dom window and vendor globals before webapp imports.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { joinLayer1Page } from "../src/viewer_layer1_page_join.ts";
import { buildLayer1Layout } from "../webapp/layer1-layout.ts";
import { getRequiredElementById } from "../webapp/app-dom.ts";

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

// proposeDimensions returning undefined makes updateProgressSize a no-op.
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

// Port 7343 matches the real viewer server default so location.origin looks authentic.
function createWebappWindow(): Window {
  return new Window({ url: "http://localhost:7343/" });
}

function installWindowGlobals(browserWindow: Window): void {
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
  });
}

function installVendorFakeGlobals(): void {
  Object.assign(globalThis, {
    ResizeObserver: FakeResizeObserver,
    Terminal: FakeXtermTerminal,
    FitAddon: { FitAddon: FakeXtermFitAddon },
    // Task 127: happy-dom has no CSS global; a Map covers the highlight set/delete calls.
    CSS: { highlights: new Map() },
  });
}

// Safe to call once per test: each call replaces every global, so stale listeners resolve against an abandoned document.
export function initWebappDom(): void {
  const browserWindow = createWebappWindow();
  installWindowGlobals(browserWindow);
  installVendorFakeGlobals();
  browserWindow.document.body.innerHTML = readIndexHtmlBodyMarkup();
}

// The layered page's body markup (task 205): index.html is the new main page.
function readLayeredHtmlBodyMarkup(): string {
  const html = readFileSync(new URL("../webapp/index.html", import.meta.url), "utf8");
  return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Fresh happy-dom window for the layered page (task 205), minus fakes the skeleton never uses.
export function initLayeredDom(): void {
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
  const html = joinLayer1Page(fileURLToPath(new URL("../webapp/layer1.html", import.meta.url)));
  return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Fresh happy-dom window for the Layer 1 page (task 237); `search` seeds the URL query.
export function initLayer1Dom(search: string = ""): void {
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
  buildLayer1Layout();
}

// The debug page's body markup (task 183): the per-file debug viewer skeleton.
function readDebugHtmlBodyMarkup(): string {
  const html = readFileSync(new URL("../webapp/debug.html", import.meta.url), "utf8");
  return html.split("<body>")[1]!.split("</body>")[0]!;
}

// Fresh happy-dom window for the debug page (task 183); `search` seeds deep-link queries.
export function initDebugDom(search: string = ""): void {
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

// Let fire-and-forget promise chains settle: three macrotask turns cover fetch, json, and completion handler steps.
export async function waitForAsyncWork(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export const PANE_WIDTH_PX = 500;
export const PANE_HEIGHT_PX = 800;
export const CONTENT_WIDTH_PX = 5000;
export const CONTENT_HEIGHT_PX = 9000;

export function readSlackPx(pane: HTMLElement, side: string): number {
  return parseFloat(pane.style.getPropertyValue(`--slack-${side}`)) || 0;
}

function clampScroll(pane: HTMLElement, wanted: number, contentPx: number, viewPx: number, startSide: string, endSide: string): number {
  const maxScroll = contentPx + readSlackPx(pane, startSide) + readSlackPx(pane, endSide) - viewPx;
  return Math.min(Math.max(wanted, 0), maxScroll);
}

// A pane that clamps scroll like a browser and shifts content by its start-side slack.
export function buildClampingPane(): HTMLElement {
  const pane = getRequiredElementById("timelineContainer");
  let scrollLeft = 0;
  let scrollTop = 0;
  Object.defineProperty(pane, "scrollLeft", {
    get: () => scrollLeft,
    set: (wanted: number) => { scrollLeft = clampScroll(pane, wanted, CONTENT_WIDTH_PX, PANE_WIDTH_PX, "left", "right"); },
  });
  Object.defineProperty(pane, "scrollTop", {
    get: () => scrollTop,
    set: (wanted: number) => { scrollTop = clampScroll(pane, wanted, CONTENT_HEIGHT_PX, PANE_HEIGHT_PX, "top", "bottom"); },
  });
  Object.defineProperty(pane, "scrollWidth", { get: () => CONTENT_WIDTH_PX + readSlackPx(pane, "left") + readSlackPx(pane, "right") });
  Object.defineProperty(pane, "scrollHeight", { get: () => CONTENT_HEIGHT_PX + readSlackPx(pane, "top") + readSlackPx(pane, "bottom") });
  Object.defineProperty(pane, "clientWidth", { get: () => PANE_WIDTH_PX });
  Object.defineProperty(pane, "clientHeight", { get: () => PANE_HEIGHT_PX });
  pane.getBoundingClientRect = () => ({ left: 0, right: PANE_WIDTH_PX, top: 0, bottom: PANE_HEIGHT_PX, width: PANE_WIDTH_PX, height: PANE_HEIGHT_PX }) as DOMRect;
  getRequiredElementById("detailsPaneContainer").getBoundingClientRect = () => ({ left: PANE_WIDTH_PX, right: PANE_WIDTH_PX, top: 0, bottom: PANE_HEIGHT_PX, width: 0, height: PANE_HEIGHT_PX }) as DOMRect;
  return pane;
}
