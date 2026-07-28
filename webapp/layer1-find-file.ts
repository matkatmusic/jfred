// The Layer 1 page's jump-to-bubble box. Exists because the render is 808 widgets across ~156,000 px,
// so hunting for a named bubble by hand is the slow step; a `?focus=<path>` deep link was rejected by
// the user 2026-07-25 as harder than typing a name.
//
// ponytail: the scroll is native `scrollIntoView`, not offsetTop/offsetLeft arithmetic — `offsetTop`
// inside the zoomed `.canvas` is UNSCALED, so hand-rolled math would land wrong at any zoom but 100%.

import { getRequiredElementById } from "./app-dom.ts";

// Module scope because the cycle is the feature: submitting the SAME term again must advance to the
// next match rather than re-landing on the first.
let cycledTerm = "";
let cycleIndex = 0;

// A LIST because a landing lights the row AND its owning bubble.
let litElements: HTMLElement[] = [];

// Fired on `document` when a jump lands; layer1-leader-visibility.ts listens to keep that element's
// dashed leader line up.
export const LANDED_EVENT = "layer1-landed";

// `.fname` is where BOTH matchable strings live: its text is the basename, its `data-path` the full
// repo-relative path.
function listNameElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")];
}

// ponytail: ONE case-insensitive substring test over the full path covers both a bare basename and a
// path fragment — no separate branch for either. Falls back to the text for label-only buckets.
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

// Exactly ONE thing on the page carries `.found` at a time, and the highlight is PERSISTENT (user,
// 2026-07-26). Exported because a ruler-tick click lands on a `.node` or bucket `li` and lights the
// same way, which is why nothing here reads the element's kind.
export function highlightLandedElement(landed: HTMLElement): void {
    for (const lit of litElements) {
        lit.classList.remove("found");
    }
    // The owning bubble is lit TOO, never instead (user, 2026-07-27). `closest` returns the element
    // itself when it already IS the bubble, so the Set collapses the find box's case.
    litElements = [...new Set([landed, landed.closest(".filebox")].filter((element) => element !== null))] as HTMLElement[];
    for (const lit of litElements) {
        lit.classList.add("found");
    }
    // A DOM event rather than calling layer1-leader-visibility.ts, which would close an import
    // cycle. `window.CustomEvent`, not the bare global: happy-dom's document only accepts events
    // built by ITS window, and node's global CustomEvent is a different class.
    document.dispatchEvent(new window.CustomEvent(LANDED_EVENT, { detail: landed }));
}

// Never a silent no-op: every submit reports here. Its OWN element, not the header's #crumb, which
// also carries the stage's pair and orphan counts that a search would destroy.
function reportFindStatus(message: string): void {
    getRequiredElementById("find-status").textContent = message;
}

// `+ matches.length` before the modulo is what makes step -1 wrap to the LAST match instead of
// yielding a negative index: JS's % keeps the sign of its left operand.
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

// Shared by the typed box and the File Nav click so neither can drift from the other's landing.
// `block: "start"`, NOT "center": a `.filebox` is as tall as its own ladder span, so centring it
// vertically puts its name and first node far above the viewport.
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

// The File Nav's caller, not the typed box's: a leaf knows its exact path, so it needs no substring
// match and no cycle — routing it through jumpToNamedBubble advanced on every repeat click.
export function jumpToBubbleAtPath(path: string): HTMLElement | undefined {
    const owner = listNameElements().find((nameElement) => nameElement.dataset.path === path);
    if (owner === undefined) {
        // Never a silent no-op: an ORPHAN path is listed in the File Nav but lives in a bucket with
        // no bubble of its own, so the click must say that rather than look broken.
        reportFindStatus(`${path}: no bubble on the timeline (listed in an orphan bucket)`);
        return undefined;
    }
    const landed = owner.closest(".filebox") as HTMLElement;
    landOnBubble(landed);
    return landed;
}

// All three pieces of a live search drop together, because leaving any one keeps part of an
// abandoned search on screen or in effect. The only thing that darkens the page.
function clearFindState(): void {
    for (const lit of litElements) {
        lit.classList.remove("found");
    }
    litElements = [];
    cycledTerm = "";
    cycleIndex = 0;
    reportFindStatus("");
}

// The two buttons step the same cycle from whatever the box currently holds, which is why they read
// `box.value` rather than carrying a term of their own.
export function wireFindFileBox(): void {
    const box = getRequiredElementById("find-file") as HTMLInputElement;
    box.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
            jumpToNamedBubble(box.value);
        }
    });
    // `input`, not `keyup`: it also fires for a paste, a cut and a click on the field's native
    // clear button, which are three more ways to empty the box that a key listener would miss.
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
