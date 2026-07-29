// Layer 1's jump-to-bubble box for 808 widgets across ~156,000 px. ponytail: uses native scrollIntoView; offsetTop is unscaled in zoomed canvas.

import { getRequiredElementById } from "./app-dom.ts";

// Module scope because the cycle is the feature: resubmitting the same term must advance to the next match, not restart.
let cycledTerm = "";
let cycleIndex = 0;

// A LIST because a landing lights the row AND its owning bubble.
let litElements: HTMLElement[] = [];

// Fired on `document` when a jump lands; layer1-leader-visibility.ts listens to keep that element's dashed leader line up.
export const LANDED_EVENT = "layer1-landed";

// `.fname` is where BOTH matchable strings live: its text is the basename, its `data-path` the full repo-relative path.
function listNameElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")];
}

// ponytail: one case-insensitive substring test over full path covers basename and fragment matches; falls back to text for label-only buckets.
function matchesSearchTerm(nameElement: HTMLElement, lowerTerm: string): boolean {
    const haystack = nameElement.dataset.path ?? nameElement.textContent ?? "";
    return haystack.toLowerCase().includes(lowerTerm);
}

// A collision is NOT an error: an ambiguous term yields a LIST that repeat-submit cycles through.
function findMatchingBubbles(lowerTerm: string): HTMLElement[] {
    return listNameElements()
        .filter((nameElement) => matchesSearchTerm(nameElement, lowerTerm))
        .map((nameElement) => nameElement.closest(".filebox") as HTMLElement);
}

// Only one thing carries `.found` at a time, stays lit (user, 2026-07-26); exported since ruler-tick clicks light the same way.
export function highlightLandedElement(landed: HTMLElement): void {
    for (const lit of litElements) {
        lit.classList.remove("found");
    }
    // The owning bubble is lit too, never instead (user, 2026-07-27); the Set collapses when `closest` returns the element itself.
    litElements = [...new Set([landed, landed.closest(".filebox")].filter((element) => element !== null))] as HTMLElement[];
    for (const lit of litElements) {
        lit.classList.add("found");
    }
    // A DOM event avoids an import cycle with layer1-leader-visibility.ts; `window.CustomEvent` is used since happy-dom rejects events from other classes.
    document.dispatchEvent(new window.CustomEvent(LANDED_EVENT, { detail: landed }));
}

// Never a silent no-op: every submit reports here, its own element, not the header's #crumb, which a search would destroy.
function reportFindStatus(message: string): void {
    getRequiredElementById("find-status").textContent = message;
}

// `+ matches.length` before modulo makes step -1 wrap to the last match, not a negative index (JS's % keeps sign).
function selectMatchAtStep(term: string, step: number): HTMLElement | undefined {
    const matches = findMatchingBubbles(term.toLowerCase());
    if (matches.length === 0) {
        cycledTerm = "";
        reportFindStatus(`find "${term}": no bubble matches`);
        return undefined;
    }
    cycleIndex = term === cycledTerm ? (cycleIndex + step + matches.length) % matches.length : 0;
    cycledTerm = term;
    const landed = matches[cycleIndex]!;
    const landedPath = landed.querySelector<HTMLElement>(".fname")?.dataset.path ?? term;
    reportFindStatus(`find "${term}": ${cycleIndex + 1} of ${matches.length} · ${landedPath}`);
    return landed;
}

// Shared by the typed box and File Nav click so both land identically; `block: "start"` avoids centring above the viewport.
function landOnBubble(bubble: HTMLElement): void {
    bubble.scrollIntoView({ block: "start", inline: "center" });
    highlightLandedElement(bubble);
}

// Jump to the next (or, with step -1, the previous) bubble named by `term`.
export function jumpToNamedBubble(term: string, step: number = 1): HTMLElement | undefined {
    const trimmed = term.trim();
    if (trimmed === "") {
        return undefined;
    }
    const landed = selectMatchAtStep(trimmed, step);
    if (landed !== undefined) {
        landOnBubble(landed);
    }
    return landed;
}

// The File Nav's caller: a leaf knows its exact path so needs no substring match or cycle, unlike jumpToNamedBubble.
export function jumpToBubbleAtPath(path: string): HTMLElement | undefined {
    const owner = listNameElements().find((nameElement) => nameElement.dataset.path === path);
    if (owner === undefined) {
        // Never a silent no-op: an orphan path has no bubble, so the click must say so, not look broken.
        reportFindStatus(`${path}: no bubble on the timeline (listed in an orphan bucket)`);
        return undefined;
    }
    const landed = owner.closest(".filebox") as HTMLElement;
    landOnBubble(landed);
    return landed;
}

// All three pieces of a live search drop together so nothing lingers; the only thing that darkens the page.
function clearFindState(): void {
    for (const lit of litElements) {
        lit.classList.remove("found");
    }
    litElements = [];
    cycledTerm = "";
    cycleIndex = 0;
    reportFindStatus("");
}

// The two buttons step the same cycle from whatever the box holds, so they read `box.value` rather than their term.
export function wireFindFileBox(): void {
    const box = getRequiredElementById("find-file") as HTMLInputElement;
    box.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
            jumpToNamedBubble(box.value);
        }
    });
    // `input`, not `keyup`: it fires for paste, cut, and clicking the clear button, ways a key listener would miss.
    box.addEventListener("input", () => {
        if (box.value.trim() !== "") {
            return;
        }
        clearFindState();
    });
    getRequiredElementById("find-prev").addEventListener("click", () => {
        jumpToNamedBubble(box.value, -1);
    });
    getRequiredElementById("find-next").addEventListener("click", () => {
        jumpToNamedBubble(box.value, 1);
    });
}
