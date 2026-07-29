// The dashed leader lines are drawn ON DEMAND (user, 2026-07-26): "I am curious to see what the timeline looks like if dashed leader lines are only drawn when the user mouses over a ruler timestamp, [or] mouses over or selects a bubble [or] a node. For all other scroll events in the timeline, no dashed lines should be drawn."
//
// So the rest state is NO lines at all, and this module decides which single line is up at any moment. `.leader` carries `opacity: 0` and layer1-styles.css lifts it for `.shown` — an opacity toggle, never display/visibility, because the lines are positioned per ruler entry and there are ~680 of them on this repo: hiding them by layout would cost a re-layout every time the pointer crossed a bubble, which is precisely the class of cost task 263 was about.
//
// The hover half is ONE delegated listener on the scroll pane rather than a listener per bubble, per node and per tick — the stage holds ~805 bubbles and ~2,400 rows, and every one of them is replaced on each render, so per-element wiring would be re-done wholesale on every filter click.
//
// The selection half listens for layer1-find-file.ts's landing event instead of importing a pin
// function into it: layer1-ruler-click.ts already imports that module, so an import in the other
// direction would close a cycle for what is one notification.

import { getRequiredElementById } from "./app-dom.ts";
import { LANDED_EVENT } from "./layer1-find-file.ts";
import { axisMatches, readAxisPx } from "./layer1-ruler-click.ts";

// The class layer1-styles.css paints the line from. Deliberately not `.aimed`: that is task 290's hover-the-LINE state, which lights the line AND its targets, while this only decides whether a line is drawn at all. A line can be shown and not aimed, and the stylesheet shows an aimed one.
const SHOWN_CLASS = "shown";

// Everything inside a bubble that carries a WIDGET-RELATIVE `--axis-px`: a pair's node dots and their labels, and an orphan bucket's list items. Same set layer1-ruler-click.ts resolves, plus `.nlabel` — the label is part of the node as far as the pointer is concerned.
const BUBBLE_ROW_SELECTOR = ".node, .nlabel, li";

// What the pointer is over, and what the last landing selected. Two slots rather than one so a hover cannot wipe the selection's line, and moving off does not have to restore it by hand.
let hoveredLeader: HTMLElement | undefined;
let selectedLeader: HTMLElement | undefined;

function listLeaderLines(): HTMLElement[] {
    return [...getRequiredElementById("leaders").querySelectorAll<HTMLElement>(".leader")];
}

// Redraw from the two slots. A slot holding a line from a previous render simply matches nothing here, so a re-render needs no reset: every live line is repainted from scratch.
function paintShownLeaders(): void {
    for (const leader of listLeaderLines()) {
        leader.classList.toggle(SHOWN_CLASS, leader === hoveredLeader || leader === selectedLeader);
    }
}

// The ABSOLUTE ruler offset an element sits at, or undefined for the page furniture between them.  The three sources the user named resolve here and nowhere else: * a ruler tick already carries the absolute offset of its instant; * a node, a node label or a bucket row carries a WIDGET-RELATIVE one, so its bubble's base is added back on — the same arithmetic layer1-ruler-click.ts's lookup does; * anything else inside a bubble (its name, its sub line, its rail) is the BUBBLE, which begins at its own offset.
function readAbsoluteAxisPx(element: HTMLElement): number | undefined {
    const tick = element.closest<HTMLElement>(".tick");
    if (tick !== null) {
        return readAxisPx(tick);
    }
    const bubble = element.closest<HTMLElement>(".filebox");
    if (bubble === null) {
        return undefined;
    }
    const row = element.closest<HTMLElement>(BUBBLE_ROW_SELECTOR);
    return readAxisPx(bubble) + (row === null ? 0 : readAxisPx(row));
}

// The one line drawn for whatever `element` sits on, or undefined when it sits on nothing — the pane's padding, the empty-state message, or a ruler entry whose line the render never produced.
function findLeaderFor(element: HTMLElement | undefined): HTMLElement | undefined {
    const axisPx = element === undefined ? undefined : readAbsoluteAxisPx(element);
    if (axisPx === undefined) {
        return undefined;
    }
    return listLeaderLines().find((leader) => axisMatches(readAxisPx(leader), axisPx));
}

// Exported for the test, which drives the resolution directly rather than through a synthetic pointer event — the interesting cases are which ELEMENT maps to which line, not event plumbing.
export function showLeaderForHoveredElement(element: HTMLElement | undefined): void {
    hoveredLeader = findLeaderFor(element);
    paintShownLeaders();
}

export function wireLeaderVisibility(): void {
    const pane = getRequiredElementById("timelines");
    // `pointerover`, not `pointerenter`: this is delegated, so it has to fire again for every descendant the pointer moves onto. `pointerleave` on the pane is the only "off" this needs — moving between two bubbles re-resolves rather than clearing, and leaving the pane entirely is the one case no `pointerover` follows.
    pane.addEventListener("pointerover", (event) => {
        showLeaderForHoveredElement(event.target as HTMLElement);
    });
    pane.addEventListener("pointerleave", () => {
        showLeaderForHoveredElement(undefined);
    });
    // A landing (find box, File Nav leaf, ruler tick — all three funnel through highlightLandedElement) IS the selection the user asked to keep a line up for, so it outlives the pointer and is replaced only by the next landing.
    document.addEventListener(LANDED_EVENT, (event) => {
        selectedLeader = findLeaderFor((event as CustomEvent<HTMLElement>).detail);
        paintShownLeaders();
    });
}
