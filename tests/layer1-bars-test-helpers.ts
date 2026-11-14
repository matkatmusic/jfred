import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { InverseCommitWire, InverseRepoFileWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";

export const TEST_INSTANT_NEWEST = "2026-11-13T12:00:00.000Z";
export const TEST_INSTANT_MIDDLE = "2026-11-13T10:00:00.000Z";
export const TEST_INSTANT_OLDEST = "2026-11-13T08:00:00.000Z";

function readBarsPartMarkup(fileName: string): string {
    return readFileSync(new URL(`../webapp/layer1-components/bars-view/${fileName}`, import.meta.url), "utf8");
}

function readBarsMarkup(): string {
    return readBarsPartMarkup("bars-view-slider.html") + readBarsPartMarkup("bars-view.html");
}

// Defaults: commitHash "c0", eventType "GitCommit", moment "at-event", confidence "proven", position 0, instant TEST_INSTANT_NEWEST, isFileAbsent false, isRemoved false, movedAwayTo null.
export function buildInverseCommit(overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return {
        commitHash: "c0",
        eventType: "GitCommit",
        moment: "at-event",
        confidence: "proven",
        position: 0,
        instant: TEST_INSTANT_NEWEST,
        isFileAbsent: false,
        isRemoved: false,
        movedAwayTo: null,
        ...overrides,
    };
}

export function buildInverseFile(file: string, commits: InverseCommitWire[]): InverseRepoFileWire {
    return { file, commits };
}

// A DiskNow commit: eventType "DiskNow", position 0, instant null. Pass { isFileAbsent: true } for a deleted file.
export function buildDiskNowCommit(overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return buildInverseCommit({ eventType: "DiskNow", position: 0, instant: null, ...overrides });
}

// Installs a bare happy-dom window (globals window, document, location, HTMLElement) whose body holds the two part files.
export function initBarsDom(): void {
    const browserWindow = new Window({ url: "http://localhost:7343/app/layer1.html" });
    Object.assign(globalThis, {
        window: browserWindow,
        document: browserWindow.document,
        location: browserWindow.location,
        HTMLElement: browserWindow.HTMLElement,
    });
    browserWindow.document.body.innerHTML = readBarsMarkup();
}

// Inserts the two part files into the current document body when #barsViewComponent is missing (use after initLayer1Dom).
export function ensureBarsMarkup(): void {
    if (document.getElementById("barsViewComponent") === null) {
        document.body.insertAdjacentHTML("beforeend", readBarsMarkup());
    }
}
