// Test page only: ruler rows show a short time, a count, and a session color.

import { createElement } from "../../app-dom.ts";
import type { WireAnnotation } from "../session-column/layer1-wire-annotations.ts";
import { rowsByTick } from "./layer1-tick-events.ts";
import { formatInstantDisplay, formatInstantLabel, type RulerRow } from "./layer1-ruler-rows.ts";

export const TICK_FULL_TIME_ATTRIBUTE = "data-full-time";
const RULER_SESSIONS_CLASS = "ruler-sessions";
const SESSION_COLOR_PROPERTY = "--session-color";
const COLOURED_CLASS = "s-coloured";

// One pass over the records: which sessions have a dot at each instant.
function listSessionsByInstant(annotations: readonly WireAnnotation[]): Map<number, Set<string>> {
  const sessionsByInstant = new Map<number, Set<string>>();
  for (const annotation of annotations) {
    const instantMs = Date.parse(annotation.instant);
    const sessions = sessionsByInstant.get(instantMs) ?? new Set<string>();
    sessions.add(annotation.sessionId);
    sessionsByInstant.set(instantMs, sessions);
  }
  return sessionsByInstant;
}

// The first child becomes span.ttime; safe on a tick done before.
function renderTickTime(tick: HTMLElement, row: RulerRow): void {
  const timeText = formatInstantDisplay(row.instants[0]!);
  const firstChild = tick.firstChild;
  const isTimeSpan = firstChild instanceof HTMLElement && firstChild.matches("span.ttime");
  if (isTimeSpan) {
    firstChild.textContent = timeText;
    return;
  }
  const timeSpan = createElement("span", { class: "ttime", text: timeText });
  if (firstChild === null) {
    tick.prepend(timeSpan);
    return;
  }
  firstChild.replaceWith(timeSpan);
}

// span.tcount sits right after the dashes; safe on a tick done before.
function renderTickCount(tick: HTMLElement, row: RulerRow): void {
  const countText = `(${row.eventCount})`;
  const countSpan = tick.querySelector<HTMLElement>(":scope > span.tcount");
  if (countSpan !== null) {
    countSpan.textContent = countText;
    return;
  }
  const anchor = tick.querySelector(":scope > .kind-dashes") ?? tick.firstChild;
  anchor?.after(createElement("span", { class: "tcount", text: countText }));
}

// The row's only session, or undefined when zero or several sessions have a dot there.
function findOnlySession(row: RulerRow, sessionsByInstant: Map<number, Set<string>>): string | undefined {
  const sessions = new Set<string>();
  for (const instant of row.instants) {
    for (const sessionId of sessionsByInstant.get(Date.parse(instant)) ?? []) {
      sessions.add(sessionId);
    }
  }
  return sessions.size === 1 ? [...sessions][0] : undefined;
}

function renderTickColor(tick: HTMLElement, sessionColor: string | undefined): void {
  tick.classList.toggle(COLOURED_CLASS, sessionColor !== undefined);
  if (sessionColor === undefined) {
    tick.style.removeProperty(SESSION_COLOR_PROPERTY);
    return;
  }
  tick.style.setProperty(SESSION_COLOR_PROPERTY, sessionColor);
}

function renderTickDisplay(tick: HTMLElement, row: RulerRow, sessionColor: string | undefined): void {
  renderTickTime(tick, row);
  renderTickCount(tick, row);
  const fullTime = formatInstantLabel(row.instants[0]!);
  tick.setAttribute(TICK_FULL_TIME_ATTRIBUTE, fullTime);
  tick.title = fullTime;
  renderTickColor(tick, sessionColor);
}

// Changes what each tick shows, never the tick count; colors only while sessions show.
export function renderRulerDisplay(annotations: readonly WireAnnotation[], colors: Map<string, string>, isSessionShown: boolean): void {
  const ruler = document.getElementById("ruler")!;
  ruler.classList.add(RULER_SESSIONS_CLASS);
  const sessionsByInstant = listSessionsByInstant(annotations);
  for (const tick of ruler.querySelectorAll<HTMLElement>(".tick")) {
    const row = rowsByTick.get(tick);
    if (row === undefined) {
      continue;
    }
    const onlySession = isSessionShown ? findOnlySession(row, sessionsByInstant) : undefined;
    renderTickDisplay(tick, row, onlySession === undefined ? undefined : colors.get(onlySession));
  }
}

export function removeRulerDisplay(): void {
  document.getElementById("ruler")?.classList.remove(RULER_SESSIONS_CLASS);
}
