// The shared hover popup: delegated mouseover fills it, mouseout hides it, one element per document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { attachHoverPopup } = await import("../webapp/layer1-components/popups/layer1-hover-popup.ts");
import type { HoverPopupContent } from "../webapp/layer1-components/popups/layer1-hover-popup.ts";

function buildContainer(): { container: HTMLElement; accepted: HTMLElement; rejected: HTMLElement } {
  initLayer1Dom();
  const container = document.createElement("div");
  const accepted = document.createElement("i");
  accepted.className = "target";
  const rejected = document.createElement("b");
  container.append(accepted, rejected);
  const page = document.createElement("div");
  page.className = "viz-root";
  page.append(container);
  document.body.append(page);
  return { container, accepted, rejected };
}

function readAcceptedContent(target: HTMLElement): HoverPopupContent | undefined {
  if (!target.classList.contains("target")) {
    return undefined;
  }
  return { lines: ["session3", "Bash: npm test"], backgroundColor: "rgb(10, 20, 30)" };
}

function dispatchMouse(target: HTMLElement, type: string): void {
  target.dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
}

function readPopup(): HTMLElement {
  return document.getElementById("hover-popup")!;
}

test("test_mouseover_on_accepted_target_shows_lines_and_background", () => {
  const { container, accepted } = buildContainer();
  attachHoverPopup(container, readAcceptedContent);
  dispatchMouse(accepted, "mouseover");
  const popup = readPopup();
  assert.equal(popup.hidden, false);
  assert.deepEqual([...popup.querySelectorAll(".hp-line")].map((line) => line.textContent), ["session3", "Bash: npm test"]);
  assert.equal(popup.style.backgroundColor, "rgb(10, 20, 30)");
});

test("test_the_popup_sits_inside_viz_root", () => {
  const { container, accepted } = buildContainer();
  attachHoverPopup(container, readAcceptedContent);
  dispatchMouse(accepted, "mouseover");
  assert.equal(readPopup().parentElement, document.querySelector(".viz-root"));
});

test("test_mouseout_hides_the_popup", () => {
  const { container, accepted } = buildContainer();
  attachHoverPopup(container, readAcceptedContent);
  dispatchMouse(accepted, "mouseover");
  dispatchMouse(accepted, "mouseout");
  assert.equal(readPopup().hidden, true);
});

test("test_mouseover_on_rejected_target_shows_nothing", () => {
  const { container, rejected } = buildContainer();
  attachHoverPopup(container, readAcceptedContent);
  dispatchMouse(rejected, "mouseover");
  assert.equal(document.getElementById("hover-popup"), null);
});

test("test_second_attach_adds_no_second_listener", () => {
  const { container, accepted } = buildContainer();
  let readCount = 0;
  function readCounted(target: HTMLElement): HoverPopupContent | undefined {
    readCount += 1;
    return readAcceptedContent(target);
  }
  attachHoverPopup(container, readCounted);
  attachHoverPopup(container, readCounted);
  dispatchMouse(accepted, "mouseover");
  assert.equal(readCount, 1);
});

test("test_repeated_hovers_keep_one_popup_element", () => {
  const { container, accepted } = buildContainer();
  attachHoverPopup(container, readAcceptedContent);
  dispatchMouse(accepted, "mouseover");
  dispatchMouse(accepted, "mouseout");
  dispatchMouse(accepted, "mouseover");
  assert.equal(document.querySelectorAll("#hover-popup").length, 1);
});
