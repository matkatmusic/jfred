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
// text is the basename (task 245 shortened the visible label to that) and its `title` is the full
// repo-relative path.
function listNameElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#stage .filebox .fname")];
}

// ponytail: ONE case-insensitive substring test over "<full path>" covers every required input.
// `launch.json` matches `.vscode/launch.json` because a basename is a substring of its own path
// (requirement 1), and `.vscode/launch` narrows a colliding basename to one bubble for free
// (requirement 2's bonus) — no separate basename branch, no separate path branch. The title falls
// back to the visible text for the orphan buckets, whose labels carry no path.
function matchesSearchTerm(nameElement: HTMLElement, lowerTerm: string): boolean {
    const haystack = nameElement.getAttribute("title") ?? nameElement.textContent ?? "";
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

// Never a silent no-op (requirement 5): every submit reports into the #crumb, whether it landed or
// not. The full path is echoed back because with a colliding basename the counter alone does not say
// WHICH of the six the viewport is now looking at.
function reportIntoCrumb(message: string): void {
    getRequiredElementById("crumb").textContent = message;
}

// Advance the cycle for `term` and return the match to land on, or undefined when nothing matches.
// A CHANGED term restarts at the first match; an unchanged one steps forward and wraps, so holding
// Enter walks all six collisions and returns to the top rather than stopping at the last.
function selectNextMatch(term: string): HTMLElement | undefined {
    const matches = findMatchingBubbles(term.toLowerCase());
    if (matches.length === 0) {
        cycledTerm = "";
        reportIntoCrumb(`find "${term}": no bubble matches`);
        return undefined;
    }
    cycleIndex = term === cycledTerm ? (cycleIndex + 1) % matches.length : 0;
    cycledTerm = term;
    const landed = matches[cycleIndex]!;
    const landedPath = landed.querySelector(".fname")?.getAttribute("title") ?? term;
    reportIntoCrumb(`find "${term}": ${cycleIndex + 1} of ${matches.length} · ${landedPath}`);
    return landed;
}

// Jump to the next bubble named by `term`. Exported for the test, which drives this rather than the
// keystroke so the cycle can be stepped without re-deriving what a happy-dom KeyboardEvent needs.
export function jumpToNamedBubble(term: string): HTMLElement | undefined {
    const trimmed = term.trim();
    if (trimmed === "") {
        return undefined;
    }
    const landed = selectNextMatch(trimmed);
    landed?.scrollIntoView({ block: "center", inline: "center" });
    if (landed !== undefined) {
        highlightBubble(landed);
    }
    return landed;
}

// Wire the box. Enter IS the submit — there is no Find button, because the input is only ever
// reached by typing into it, so the hand is already on the keyboard.
export function wireFindFileBox(): void {
    const box = getRequiredElementById("find-file") as HTMLInputElement;
    box.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
            jumpToNamedBubble(box.value);
        }
    });
}
