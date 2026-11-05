// One shared hover popup: containers register a reader, a delegated mouseover fills and places the popup.

import { createElement } from "./app-dom.ts";

export interface HoverPopupContent {
  lines: string[];
  backgroundColor?: string;
}

type ReadHoverPopupContent = (target: HTMLElement) => HoverPopupContent | undefined;

const POPUP_ID = "hover-popup";
const POPUP_GAP_PX = 8;

// The reader per container; a second attach swaps the reader and adds no listener.
const readersByContainer = new WeakMap<HTMLElement, ReadHoverPopupContent>();

function findOrBuildPopupElement(): HTMLElement {
  const existing = document.getElementById(POPUP_ID);
  if (existing !== null) {
    return existing;
  }
  const popup = createElement("div", { id: POPUP_ID, class: "hover-popup", hidden: "" });
  const page = document.querySelector(".viz-root");
  if (page === null) {
    throw new Error("hover popup needs the .viz-root page element");
  }
  page.append(popup);
  return popup;
}

function setPopupContent(popup: HTMLElement, content: HoverPopupContent): void {
  popup.replaceChildren(...content.lines.map((line) => createElement("div", { class: "hp-line", text: line })));
  popup.style.backgroundColor = content.backgroundColor ?? "";
}

function setPopupPlace(popup: HTMLElement, target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  popup.style.left = `${rect.right + POPUP_GAP_PX}px`;
  popup.style.top = `${rect.top}px`;
}

function renderPopupOnMouseOver(event: Event): void {
  const container = event.currentTarget as HTMLElement;
  const target = event.target as HTMLElement;
  const content = readersByContainer.get(container)?.(target);
  if (content === undefined) {
    return;
  }
  const popup = findOrBuildPopupElement();
  setPopupContent(popup, content);
  setPopupPlace(popup, target);
  popup.hidden = false;
}

function hidePopupOnMouseOut(): void {
  const popup = document.getElementById(POPUP_ID);
  if (popup !== null) {
    popup.hidden = true;
  }
}

// Same function references on every call, so addEventListener drops the duplicate.
export function attachHoverPopup(container: HTMLElement, readContent: ReadHoverPopupContent): void {
  readersByContainer.set(container, readContent);
  container.addEventListener("mouseover", renderPopupOnMouseOver);
  container.addEventListener("mouseout", hidePopupOnMouseOut);
}
