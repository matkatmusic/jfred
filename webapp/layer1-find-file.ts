// The Layer 1 page's jump-to-bubble box (task 261). Split out of layer1-page.ts for the same reason
// layer1-zoom.ts was: that file is at the repo's 250-line cap, and nothing else on the page reads a
// search term.
//
// WHY this exists: the agreed verification handoff is that Claude names ONE bubble and the user
// checks it by eye. The real render is 808 widgets across ~156,000 px, so HUNTING for that bubble is
// the slow step that undermines the handoff. A `?focus=<path>` deep link was considered and REJECTED
// by the user 2026-07-25 — copying a long URL out of CLI output is harder than typing a name — so
// this is a text box only.
//
// ponytail: the scroll is native `scrollIntoView({ block: "center", inline: "center" })`, used in
// ~12 other places in this webapp, NOT offsetTop/offsetLeft arithmetic. That choice is what makes
// the zoom control a non-issue: `offsetTop` inside the zoomed `.canvas` is UNSCALED, so hand-rolled
// math would land wrong at any level other than 100%, whereas native `zoom` participates in layout
// and scrollIntoView is defined against the laid-out box. Both axes and both centred in one call —
// a bubble is placed vertically by its `--axis-px` margin-top and horizontally by its column index
// in `.stage`, so a single-axis scroll would leave it off screen sideways.

import { getRequiredElementById } from "./app-dom.ts";

// How long the landed bubble stays lit, in ms. Long enough to catch the eye after the scroll
// settles, short enough that it is gone before the user starts judging the bubble's own styling —
// which is the whole point of looking at it.
const HIGHLIGHT_MS = 1500;

// The term the counter is currently counting through, and how far through it we are. Held at module
// scope because the cycle is the feature: submitting the SAME term again must advance to the next
// match rather than re-landing on the first.
let cycledTerm = "";
let cycleIndex = 0;

// The lit bubble and its pending un-lighting, so a second jump cancels the first's timer instead of
// letting it switch the light off under the new bubble.
let litBubble: HTMLElement | undefined;
let unlightTimer: ReturnType<typeof setTimeout> | undefined;

// Every bubble's name element, in render order. `.fname` is where BOTH matchable strings live: its
// text is the basename (task 245 shortened the visible label to that) and its `data-path` is the
// full repo-relative path (task 280 moved it off `title`, which rendered as an unstyled native
// tooltip the user rejected in favour of an in-page hover reveal).
function listNameElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")];
}

// ponytail: ONE case-insensitive substring test over "<full path>" covers every required input.
// `launch.json` matches `.vscode/launch.json` because a basename is a substring of its own path
// (requirement 1), and `.vscode/launch` narrows a colliding basename to one bubble for free
// (requirement 2's bonus) — no separate basename branch, no separate path branch. The data-path
// falls back to the visible text for the orphan buckets, whose labels carry no path.
function matchesSearchTerm(nameElement: HTMLElement, lowerTerm: string): boolean {
    const haystack = nameElement.dataset.path ?? nameElement.textContent ?? "";
    return haystack.toLowerCase().includes(lowerTerm);
}

// The bubbles a term names, oldest-first. A collision is NOT an error (requirement 2): this repo
// alone renders six `launch.json`/`tasks.json` bubbles, so an ambiguous term yields a LIST that
// repeat-submit cycles through, rather than a rejection.
function findMatchingBubbles(lowerTerm: string): HTMLElement[] {
    return listNameElements()
        .filter((nameElement) => matchesSearchTerm(nameElement, lowerTerm))
        .map((nameElement) => nameElement.closest(".filebox") as HTMLElement);
}

// Light the landed bubble so it is obvious WHICH one was targeted (requirement 4), and darken the
// previous one. The timer handle is cleared first: without it, two jumps 200 ms apart would leave
// the first jump's expiry to switch the second jump's light off early.
function highlightBubble(bubble: HTMLElement): void {
    clearTimeout(unlightTimer);
    litBubble?.classList.remove("found");
    litBubble = bubble;
    bubble.classList.add("found");
    unlightTimer = setTimeout(() => bubble.classList.remove("found"), HIGHLIGHT_MS);
}

// Never a silent no-op (requirement 5): every submit reports here, whether it landed or not. Its
// OWN element, not the header's #crumb (task 273): the crumb also carries the stage's pair and
// orphan counts, so writing a search into it destroyed those, and nothing put them back when the
// search was abandoned. A dedicated element makes clearing this readout one empty string.
function reportFindStatus(message: string): void {
    getRequiredElementById("find-status").textContent = message;
}

// Advance the cycle for `term` by `step` (+1 next, -1 previous) and return the match to land on, or
// undefined when nothing matches. A CHANGED term restarts at the first match whichever direction
// asked for it — a first search has no position to step from. `+ matches.length` before the modulo
// is what makes -1 wrap to the LAST match instead of yielding a negative index (task 271): JS's %
// keeps the sign of its left operand.
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

// Scroll a found bubble into view and light it. Shared by the typed box and the File Nav click so
// neither can drift from the other's landing behaviour.
//
// Task 277: `block: "start"`, NOT "center". A `.filebox` is as tall as its own ladder span
// (`margin-top` = --axis-px, `.lane`'s `min-height` = --span-px + 18px), so a file with a long
// history is thousands of px tall and centring that box vertically puts its top — its name, its
// first node — far above the viewport. That reads as "the jump only scrolled sideways", which is
// exactly what the user reported. `inline: "center"` stays: horizontal centring was always correct,
// because a bubble is placed sideways by its column index in `.stage`.
function landOnBubble(bubble: HTMLElement): void {
    bubble.scrollIntoView({ block: "start", inline: "center" });
    highlightBubble(bubble);
}

// Jump to the next (or, with step -1, the previous) bubble named by `term`. Exported for the test,
// which drives this rather than the keystroke so the cycle can be stepped without re-deriving what
// a happy-dom KeyboardEvent needs.
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

// Jump to the bubble owning EXACTLY `path` (task 278). The File Nav's caller, not the typed box's:
// a leaf knows the exact path it represents, so it needs no substring match, no cycle counter and
// no "n of N" crumb — clicking one file twice must land the same bubble twice. Routing a click
// through jumpToNamedBubble made a repeat click advance to the next match instead, and for
// `.gitignore`, whose root path is a substring of every nested one, no substring rule could ever
// have picked the right bubble.
export function jumpToBubbleAtPath(path: string): HTMLElement | undefined {
    const owner = listNameElements().find((nameElement) => nameElement.dataset.path === path);
    if (owner === undefined) {
        // Never a silent no-op: an ORPHAN path is listed in the File Nav but has no bubble of its
        // own — it lives in one of the two buckets — so the click must say that rather than look
        // broken.
        reportFindStatus(`${path}: no bubble on the timeline (listed in an orphan bucket)`);
        return undefined;
    }
    const landed = owner.closest(".filebox") as HTMLElement;
    landOnBubble(landed);
    return landed;
}

// Task 273: put the box back to its untouched state. All three pieces of a live search are dropped
// together — the readout, the lit bubble and the cycle position — because leaving any one of them
// keeps some part of an abandoned search on screen or in effect.
function clearFindState(): void {
    clearTimeout(unlightTimer);
    litBubble?.classList.remove("found");
    litBubble = undefined;
    cycledTerm = "";
    cycleIndex = 0;
    reportFindStatus("");
}

// Wire the box. Enter submits and steps forward; the two buttons step the same cycle in either
// direction (task 271) from whatever the box currently holds, which is why they read `box.value`
// rather than carrying a term of their own.
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
