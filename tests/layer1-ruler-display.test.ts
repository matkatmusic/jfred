// Test for webapp/layer1-ruler-display.ts: tick text, full time, and one-session colors on the test page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-wire-annotations.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderRulerDisplay, removeRulerDisplay, TICK_FULL_TIME_ATTRIBUTE } = await import("../webapp/layer1-ruler-display.ts");
const { storeRow } = await import("../webapp/layer1-tick-events.ts");
const { listSessionColors } = await import("../webapp/layer1-session-colors.ts");
const { createElement } = await import("../webapp/app-dom.ts");

const FIRST_INSTANT = "2026-06-01T09:05:07.123Z";
const SECOND_INSTANT = "2026-06-01T09:06:00.000Z";
const THIRD_INSTANT = "2026-06-01T09:07:00.000Z";

function buildRecord(id: string, instant: string, sessionId: string): WireAnnotation {
  return { id, kind: WireRecordKind.user, instant, label: id, sessionId, sessionTitle: sessionId, sessionFile: `/x/${sessionId}.jsonl`, line: 1000 };
}

// Three ticks shaped as the real render leaves them: a text node, then the dashes span.
function drawTicks(): HTMLElement[] {
  initLayer1Dom();
  const ticks: HTMLElement[] = [];
  const instants = [FIRST_INSTANT, SECOND_INSTANT, THIRD_INSTANT];
  for (let index = 0; index < instants.length; index++) {
    const tick = createElement("div", { class: "tick", text: "old text" }, [createElement("span", { class: "kind-dashes" })]);
    document.getElementById("ruler")!.append(tick);
    storeRow(tick, { axisPx: index * 22, text: "old text", eventCount: index + 1, axisPxList: [index * 22], instants: [instants[index]!] });
    ticks.push(tick);
  }
  return ticks;
}

function renderRecords(records: WireAnnotation[], isSessionShown: boolean): void {
  renderRulerDisplay(records, listSessionColors(records), isSessionShown);
}

const ONE_SESSION_PER_ROW = [
  buildRecord("a", FIRST_INSTANT, "s1"),
  buildRecord("b", SECOND_INSTANT, "s2"),
  buildRecord("c", SECOND_INSTANT, "s2"),
];

test("test_the_tick_count_is_the_same_before_and_after", () => {
  drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.equal(document.querySelectorAll("#ruler .tick").length, 3);
});

test("test_the_dashes_stay_the_second_child", () => {
  const [tick] = drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.ok((tick!.childNodes[1] as HTMLElement).matches(".kind-dashes"));
});

test("test_the_tick_shows_the_short_time_and_the_count", () => {
  const [tick] = drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.equal(tick!.querySelector(".ttime")!.textContent, "06-01-2026:09:05");
  assert.equal(tick!.querySelector(".tcount")!.textContent, "(1)");
  assert.equal(tick!.getAttribute(TICK_FULL_TIME_ATTRIBUTE), "06-01 09:05:07.123");
  assert.equal(tick!.title, "06-01 09:05:07.123");
});

test("test_two_sessions_at_one_instant_leave_the_plain_color", () => {
  const [tick] = drawTicks();
  renderRecords([buildRecord("a", FIRST_INSTANT, "s1"), buildRecord("b", FIRST_INSTANT, "s2")], true);
  assert.equal(tick!.classList.contains("s-coloured"), false);
  assert.equal(tick!.style.getPropertyValue("--session-color"), "");
});

test("test_one_session_sets_the_color_while_the_session_button_is_on", () => {
  const [tick] = drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.ok(tick!.classList.contains("s-coloured"));
  assert.equal(tick!.style.getPropertyValue("--session-color"), listSessionColors(ONE_SESSION_PER_ROW).get("s1"));
});

test("test_the_session_button_off_leaves_no_color_and_on_then_off_removes_it", () => {
  const ticks = drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, false);
  assert.equal(document.querySelectorAll("#ruler .s-coloured").length, 0);
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.ok(ticks[0]!.classList.contains("s-coloured"));
  renderRecords(ONE_SESSION_PER_ROW, false);
  for (const tick of ticks) {
    assert.equal(tick.classList.contains("s-coloured"), false);
    assert.equal(tick.style.getPropertyValue("--session-color"), "");
  }
});

test("test_a_second_call_on_the_same_ticks_adds_nothing", () => {
  const [tick] = drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, true);
  const textAfterFirst = tick!.textContent;
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.equal(tick!.querySelectorAll(".ttime").length, 1);
  assert.equal(tick!.querySelectorAll(".tcount").length, 1);
  assert.equal(tick!.textContent, textAfterFirst);
});

test("test_removing_the_display_takes_the_class_off_the_ruler", () => {
  drawTicks();
  renderRecords(ONE_SESSION_PER_ROW, true);
  assert.ok(document.getElementById("ruler")!.classList.contains("ruler-sessions"));
  removeRulerDisplay();
  assert.equal(document.getElementById("ruler")!.classList.contains("ruler-sessions"), false);
});
