// Task 292: per picked JSONL, a bar for the session's extent and a wash over the stretch of
// timeline it covers (plans/layer1-mockup.html:715-726, 871-895).
//
// This is the page's ONLY time arithmetic, and it exists because a session opens and closes BETWEEN
// events rather than on them: the S18 ruler is capped and floored rather than linear in time, so an
// arbitrary instant's position can only be read by interpolating between the two ticks it falls
// between. Everything else on this page is handed a finished `axisPx`.

import { el, getRequiredElementById } from "./app-dom.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import type { WireRulerTick, WireSession } from "./layer1-wire.ts";

// Where an ARBITRARY instant sits on an axis built from events. Clamped at both ends: a session
// that opened before the first recorded event still has to start somewhere on screen.
export function resolveAxisPixelsAt(instantMs: number, ticks: readonly WireRulerTick[]): number {
    const first = ticks[0];
    const last = ticks[ticks.length - 1];
    if (first === undefined || last === undefined) {
        return 0;
    }
    if (instantMs <= Date.parse(first.instant)) {
        return first.axisPx;
    }
    const afterIndex = ticks.findIndex((tick) => Date.parse(tick.instant) >= instantMs);
    if (afterIndex < 0) {
        return last.axisPx;
    }
    const after = ticks[afterIndex]!;
    const before = ticks[afterIndex - 1]!;
    const afterMs = Date.parse(after.instant);
    const beforeMs = Date.parse(before.instant);
    if (afterMs === instantMs) {
        return after.axisPx;
    }
    return before.axisPx + (after.axisPx - before.axisPx) * ((instantMs - beforeMs) / (afterMs - beforeMs));
}

// One absolutely-placed strip: the two numbers both marks are built from.
function buildMark(className: string, fromPx: number, spanPx: number): HTMLElement {
    const node = el("div", { class: className });
    node.style.setProperty("--axis-px", String(fromPx));
    node.style.setProperty("--span-px", String(spanPx));
    return node;
}

// The WASH closes on the first and last EVENT inside the session's window (user, 2026-07-27), half
// a row clear of each so the dots and their labels sit inside it rather than on its edge. A session
// whose window catches no event gets a bar and no wash — there is nothing for it to close on.
//
// ponytail: the foot assumes ONE node row at the last covered tick, because the wire carries no
// per-instant row count. On a tick that stacks two nodes the wash ends half a row short; put the
// row count on WireRulerTick if that is ever reported.
function buildSessionWash(session: WireSession, ticks: readonly WireRulerTick[]): HTMLElement | undefined {
    const startedMs = Date.parse(session.started);
    const endedMs = Date.parse(session.ended);
    const covered = ticks.filter((tick) => {
        const instantMs = Date.parse(tick.instant);
        return instantMs >= startedMs && instantMs <= endedMs;
    });
    const firstCovered = covered[0];
    const lastCovered = covered[covered.length - 1];
    if (firstCovered === undefined || lastCovered === undefined) {
        return undefined;
    }
    const topPx = firstCovered.axisPx - RULER_NODE_ROW_PIXELS / 2;
    const footPx = lastCovered.axisPx + RULER_NODE_ROW_PIXELS / 2;
    return buildMark("range-wash", topPx, footPx - topPx);
}

// A gutter row whose position falls inside a picked session's band is marked, so the ruler says
// which timestamps the session is answerable for. Read off the ELEMENT's own `--axis-px` rather
// than off its instants: the bands are already in axis pixels, and a merged row stands for several
// instants but sits at exactly one offset.
function markTicksInsideBands(bands: readonly { fromPx: number; toPx: number }[]): void {
    for (const tick of getRequiredElementById("ruler").querySelectorAll(".tick")) {
        const axisPx = Number((tick as HTMLElement).style.getPropertyValue("--axis-px"));
        tick.classList.toggle("inrange", bands.some((band) => axisPx >= band.fromPx && axisPx <= band.toPx));
    }
}

// One session's bar, its band, and its wash if it covers anything. `slot` is which lane the 7 px
// bar occupies, so two picked sessions never overlap.
function buildSessionMarks(session: WireSession, slot: number, ticks: readonly WireRulerTick[]) {
    const fromPx = resolveAxisPixelsAt(Date.parse(session.started), ticks);
    const toPx = resolveAxisPixelsAt(Date.parse(session.ended), ticks);
    const bar = buildMark("range", fromPx, toPx - fromPx);
    bar.style.setProperty("--slot", String(slot));
    // The name is a tooltip rather than printed text — the lane is 7 px wide, which is the price of
    // never covering a bubble.
    bar.title = `${session.file}\n${session.started} → ${session.ended}`;
    return { bar, band: { fromPx, toPx }, wash: buildSessionWash(session, ticks) };
}

// Draw every picked session's bar and wash, and mark the gutter rows they cover. Called at the end
// of a stage render, because both are measured against the ruler the stage was just drawn with.
export function renderSessionRanges(sessions: readonly WireSession[], ticks: readonly WireRulerTick[]): void {
    const marks = ticks.length === 0
        ? []
        : sessions.map((session, slot) => buildSessionMarks(session, slot, ticks));
    getRequiredElementById("washes").replaceChildren(
        ...marks.map((mark) => mark.wash).filter((wash) => wash !== undefined),
    );
    getRequiredElementById("ranges").replaceChildren(...marks.map((mark) => mark.bar));
    markTicksInsideBands(marks.map((mark) => mark.band));
}
