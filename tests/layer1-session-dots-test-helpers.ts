// Shared helpers for the real session dots tests: ticks, dots, a hand-finished dots fetch, pane size, page setup.

import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation, WireSessionDots } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
const { writeSourcePaths } = await import("../webapp/layer1-components/top-bars/layer1-source-paths.ts");
const { isSessionColumnShown, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

export const RECORD_COUNT = 70;
export const TICK_SPACING_PX = 50;
export const SESSION_DOTS_PATHNAME = "/api/layer1-session-dots";

// Tick k is k hours after the first and 50 px further down the axis.
export function buildTicks(): WireRulerTick[] {
    const ticks: WireRulerTick[] = [];
    for (let index = 0; index < RECORD_COUNT; index++) {
        const instant = new Date(Date.parse("2026-06-01T00:00:00Z") + index * 3600_000).toISOString();
        ticks.push({ instant, axisPx: index * TICK_SPACING_PX, eventCount: 1 });
    }
    return ticks;
}

export function buildDot(id: string, instant: string, sessionId: string, kind: WireRecordKind = WireRecordKind.user): WireAnnotation {
    return { id, kind, instant, label: id, sessionId, sessionTitle: `title ${sessionId}`, sessionFile: `/x/${sessionId}.jsonl`, line: 1000 };
}

export interface DeferredDotsFetch {
    askUrls: string[];
    finishAsk(askIndex: number, answer: WireSessionDots): void;
}

// Each fetch waits until the test calls finishAsk with that ask's index (0 = first ask).
export function installDeferredDotsFetch(): DeferredDotsFetch {
    const askUrls: string[] = [];
    const resolveAsks: ((response: Response) => void)[] = [];
    Object.assign(globalThis, {
        fetch: (url: unknown): Promise<Response> => {
            // Page boot fetches (/api/config, /api/layer1-settings) are not session dots asks: they never answer and are not counted.
            if (new URL(String(url), "http://localhost").pathname !== SESSION_DOTS_PATHNAME) {
                return new Promise<Response>(() => {});
            }
            askUrls.push(String(url));
            return new Promise<Response>((resolve) => resolveAsks.push(resolve));
        },
    });
    function finishAsk(askIndex: number, answer: WireSessionDots): void {
        resolveAsks[askIndex]!({ ok: true, status: 200, json: async () => answer } as unknown as Response);
    }
    return { askUrls, finishAsk };
}

export function setPaneSize(clientHeight: number, scrollTop: number): void {
    const pane = getRequiredElementById("timelineContainer");
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: clientHeight });
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: scrollTop });
}

export function setUpSessionDotsPage(): void {
    initLayer1Dom();
    initLayer1Page();
    writeSourcePaths(SourceKind.jsonl, ["/logs"]);
    getInputById("dir").value = "/work";
}

export function resetSessionDotsPage(): void {
    writeSourcePaths(SourceKind.jsonl, []);
    if (isSessionColumnShown()) {
        toggleSessionDotLines();
    }
}
