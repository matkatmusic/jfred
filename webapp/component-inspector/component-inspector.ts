// Component inspector: with the page's "names" switch on, hover and click walk the page one data-component level at a time.

import { createElement } from "../app-dom.ts";
import { buildCopyText, buildHierarchyText, ComponentSource, findPartsToEnter, readComponentName } from "./component-inspector-pick.ts";

const INSPECTOR_CSS = `
.ci-own { font: 12px/1.3 system-ui, sans-serif; }
.ci-own[hidden] { display: none; }
[data-component-inspector-toggle][aria-pressed="true"] { background: #2563eb; color: #fff; }
.ci-overlay { position: fixed; z-index: 2147483646; pointer-events: none; background: rgba(37, 99, 235, 0.25); outline: 2px solid #2563eb; }
.ci-label { position: absolute; left: 0; top: 0; padding: 1px 6px; background: #2563eb; color: #fff; }
.ci-row { display: flex; align-items: center; gap: 12px; padding: 7px 16px; border-bottom: 1px solid var(--border, #ccc); background: var(--surface, #fff); color: var(--ink, #111); }
.ci-zoomed body * { visibility: hidden; }
.ci-zoomed .ci-entered, .ci-zoomed .ci-entered * { visibility: visible; }
.ci-zoomed .ci-own, .ci-zoomed .ci-own * { visibility: visible; }
`;

const BLOCKED_EVENT_TYPES = ["pointerdown", "mousedown", "click", "dblclick"];
const COPIED_TEXT_DURATION_MS = 5000;

interface InspectorState {
  toggleButton: HTMLElement;
  rows: HTMLElement;
  overlay: HTMLElement;
  labelText: HTMLElement;
  infoRow: HTMLElement;
  copyButton: HTMLButtonElement;
  copiedResetTimer: ReturnType<typeof setTimeout> | undefined;
  enteredParts: Element[];
  lockedPart: Element | null;
  shownPart: Element | null;
  sourceByPart: Map<Element, Promise<ComponentSource>>;
  isOn: boolean;
}

// Set by each install; the listeners installed on an abandoned document never fire again.
let inspector: InspectorState;

function findRequiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`page markup is missing ${selector}`);
  }
  return element;
}

async function fetchComponentSource(name: string): Promise<ComponentSource> {
  const response = await fetch(`/api/component-source?name=${encodeURIComponent(name)}`);
  if (!response.ok) {
    throw new Error(`component source request for ${name} failed: ${response.status}`);
  }
  return (await response.json()) as ComponentSource;
}

function readStackTop(): Element | null {
  return inspector.enteredParts.at(-1) ?? null;
}

function readShownPart(): Element | null {
  return inspector.shownPart ?? readStackTop();
}

function isOwnElement(target: Element): boolean {
  return target.closest(".ci-own") !== null;
}

async function renderSourceLocation(part: Element): Promise<void> {
  const source = await inspector.sourceByPart.get(part)!;
  if (readShownPart() === part) {
    inspector.infoRow.textContent = `${buildHierarchyText(part)} (${source.file}:${source.line})`;
  }
}

function renderRows(): void {
  const shownPart = readShownPart();
  inspector.copyButton.disabled = shownPart === null;
  if (shownPart === null) {
    inspector.infoRow.textContent = "page root";
  }
  else {
    inspector.infoRow.textContent = buildHierarchyText(shownPart);
    if (!inspector.sourceByPart.has(shownPart)) {
      inspector.sourceByPart.set(shownPart, fetchComponentSource(readComponentName(shownPart)));
    }
    void renderSourceLocation(shownPart);
  }
}

// The part's box cut to the window and every clipping ancestor, so a scrolled part's label stays on screen.
function readVisiblePartBox(part: Element): DOMRect {
  const box = part.getBoundingClientRect();
  let left = Math.max(box.left, 0);
  let top = Math.max(box.top, 0);
  let right = Math.min(box.right, window.innerWidth);
  let bottom = Math.min(box.bottom, window.innerHeight);
  for (let ancestor = part.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    if (window.getComputedStyle(ancestor).overflow !== "visible") {
      const clip = ancestor.getBoundingClientRect();
      left = Math.max(left, clip.left);
      top = Math.max(top, clip.top);
      right = Math.min(right, clip.right);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  return new window.DOMRect(left, top, Math.max(right - left, 0), Math.max(bottom - top, 0));
}

function renderOverlayOver(candidate: Element): void {
  const box = readVisiblePartBox(candidate);
  const { overlay, labelText } = inspector;
  overlay.style.left = `${box.left}px`;
  overlay.style.top = `${box.top}px`;
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
  labelText.textContent = readComponentName(candidate);
  overlay.hidden = false;
}

function renderCandidateOverlay(candidate: Element | null): void {
  if (candidate === null) {
    inspector.overlay.hidden = true;
  }
  else {
    renderOverlayOver(candidate);
  }
}

function pushEnteredPart(part: Element): void {
  readStackTop()?.classList.remove("ci-entered");
  inspector.enteredParts.push(part);
  part.classList.add("ci-entered");
  document.documentElement.classList.add("ci-zoomed");
  inspector.lockedPart = null;
  inspector.shownPart = null;
  inspector.overlay.hidden = true;
  renderRows();
}

function popStackTop(): void {
  const leftPart = inspector.enteredParts.pop();
  if (leftPart !== undefined) {
    leftPart.classList.remove("ci-entered");
    inspector.sourceByPart.delete(leftPart);
  }
  readStackTop()?.classList.add("ci-entered");
  inspector.shownPart = null;
  const enteredCount = inspector.enteredParts.length;
  if (enteredCount === 0) {
    document.documentElement.classList.remove("ci-zoomed");
  }
  renderRows();
}

function clearEnteredParts(): void {
  while (inspector.enteredParts.length > 0) {
    popStackTop();
  }
  inspector.overlay.hidden = true;
}

function toggleInspector(): void {
  inspector.isOn = !inspector.isOn;
  inspector.toggleButton.setAttribute("aria-pressed", String(inspector.isOn));
  inspector.rows.hidden = !inspector.isOn;
  if (inspector.isOn) {
    renderRows();
  }
  else {
    inspector.lockedPart = null;
    inspector.shownPart = null;
    clearEnteredParts();
  }
}

async function copyShownPartText(): Promise<void> {
  const shownPart = readShownPart()!;
  const source = await inspector.sourceByPart.get(shownPart)!;
  const copyText = buildCopyText(readComponentName(shownPart), source, buildHierarchyText(shownPart));
  await navigator.clipboard.writeText(copyText);
  inspector.copyButton.textContent = "Copied";
  clearTimeout(inspector.copiedResetTimer);
  inspector.copiedResetTimer = setTimeout(resetCopyButtonText, COPIED_TEXT_DURATION_MS);
}

function resetCopyButtonText(): void {
  inspector.copyButton.textContent = "Copy";
}

function updateOverlayOnPointerMove(event: Event): void {
  if (inspector.isOn) {
    const target = event.target as Element;
    const isOwn = isOwnElement(target);
    const deepestPart = isOwn ? null : target.closest("[data-component]");
    renderCandidateOverlay(deepestPart);
    if (!isOwn) {
      if (inspector.lockedPart === null) {
        showDeepestPartUnder(target);
      }
    }
  }
}

function showDeepestPartUnder(target: Element): void {
  const deepestPart = target.closest("[data-component]");
  if (deepestPart !== inspector.shownPart) {
    inspector.shownPart = deepestPart;
    renderRows();
  }
}

function lockDeepestPartOnClick(eventType: string, target: Element): void {
  if (eventType === "click") {
    const deepestPart = target.closest("[data-component]");
    if (deepestPart !== null) {
      inspector.lockedPart = deepestPart;
      inspector.shownPart = deepestPart;
      renderRows();
    }
  }
}

function pushShownPartOnDoubleClick(eventType: string, target: Element): void {
  if (eventType === "dblclick") {
    for (const part of findPartsToEnter(target, readStackTop())) {
      pushEnteredPart(part);
    }
  }
}

function blockPageEvent(event: Event): void {
  if (inspector.isOn) {
    const target = event.target as Element;
    const isOwn = isOwnElement(target);
    if (!isOwn) {
      event.preventDefault();
      event.stopPropagation();
      lockDeepestPartOnClick(event.type, target);
      pushShownPartOnDoubleClick(event.type, target);
    }
  }
}

function popOnEscapeKey(event: KeyboardEvent): void {
  if (inspector.isOn) {
    if (event.key === "Escape") {
      if (inspector.lockedPart === null) {
        popStackTop();
      }
      else {
        inspector.lockedPart = null;
        inspector.shownPart = null;
        renderRows();
      }
    }
  }
}

function createInspectorState(): InspectorState {
  const labelText = createElement("span", { class: "ci-label" });
  const copyButton = createElement("button", { class: "ci-copy", text: "Copy", onclick: copyShownPartText }) as HTMLButtonElement;
  return {
    toggleButton: findRequiredElement("[data-component-inspector-toggle]"),
    rows: findRequiredElement("[data-component-inspector-rows]"),
    overlay: createElement("div", { class: "ci-own ci-overlay", hidden: "" }, [labelText]),
    labelText,
    infoRow: createElement("div", { class: "ci-row ci-info" }),
    copyButton,
    copiedResetTimer: undefined,
    enteredParts: [],
    lockedPart: null,
    shownPart: null,
    sourceByPart: new Map(),
    isOn: false,
  };
}

function appendInspectorUi(): void {
  const { toggleButton, rows, overlay, infoRow, copyButton } = inspector;
  toggleButton.classList.add("ci-own");
  toggleButton.setAttribute("aria-pressed", "false");
  toggleButton.addEventListener("click", toggleInspector);
  rows.classList.add("ci-own");
  rows.hidden = true;
  rows.append(infoRow, createElement("div", { class: "ci-row" }, [copyButton]));
  document.head.append(createElement("style", { text: INSPECTOR_CSS }));
  document.body.append(overlay);
}

function attachPageListeners(): void {
  document.addEventListener("pointermove", updateOverlayOnPointerMove, true);
  document.addEventListener("keydown", popOnEscapeKey);
  for (const eventType of BLOCKED_EVENT_TYPES) {
    document.addEventListener(eventType, blockPageEvent, true);
  }
}

export function installComponentInspector(): void {
  inspector = createInspectorState();
  appendInspectorUi();
  renderRows();
  attachPageListeners();
}

installComponentInspector();
