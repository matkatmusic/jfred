// Tasks 308, 316: fade-highlight (not select) the JSONL rows a snapshot or bubble click came from.

import { getRequiredElementById } from "./app-dom.ts";
import { listSessionPathsInProject, listVisibleSessions } from "./layer1-sessions.ts";
import type { WireSession } from "./layer1-wire.ts";

const FLASH_MS = 2600;

function removeClass(row: HTMLElement, className: string): void {
  row.classList.remove(className);
}

// The best match leads first and gets `flash-lead`.
function addSessionFlash(...files: string[]): void {
  const pane = getRequiredElementById("sessions");
  for (const lit of pane.querySelectorAll(".flash, .flash-lead")) {
    lit.classList.remove("flash", "flash-lead");
  }
  const items = [...pane.querySelectorAll<HTMLElement>(".session-item")];
  const rows: HTMLElement[] = [];
  for (const file of files) {
    for (const item of items) {
      if (item.dataset.file === file) {
        rows.push(item);
        break;
      }
    }
  }
  for (const row of rows) {
    // Restart the fade: an animation replays only after the class leaves for one layout.
    row.classList.remove("flash");
    void row.offsetWidth;
    row.style.setProperty("--flash-ms", `${FLASH_MS}ms`);
    row.classList.add("flash");
    setTimeout(removeClass, FLASH_MS, row, "flash");
  }
  const lead = rows[0];
  if (lead === undefined) {
    return;
  }
  lead.classList.add("flash-lead");
  setTimeout(removeClass, FLASH_MS, lead, "flash-lead");
  lead.scrollIntoView?.({ block: "nearest" });
}

function measureDistanceToClick(node: HTMLElement, clientY: number): number {
  const rect = node.getBoundingClientRect();
  return Math.abs(rect.top + rect.height / 2 - clientY);
}

// The `.node` nearest the click vertically gives the instant of the click.
function readInstantNearestClick(box: Element, clientY: number): number {
  const nodes = [...box.querySelectorAll<HTMLElement>(".node")];
  let nearest = nodes[0]!;
  for (const node of nodes) {
    const isCloser = measureDistanceToClick(node, clientY) < measureDistanceToClick(nearest, clientY);
    if (isCloser) {
      nearest = node;
    }
  }
  return Date.parse(nearest.dataset.instant!);
}

// How far an instant falls outside a session's window; 0 inside it.
function measureSessionGap(session: WireSession, instant: number): number {
  return Math.max(0, Date.parse(session.started) - instant, instant - Date.parse(session.ended));
}

// A bubble click (not a node or label click) flashes the sessions that touched it.
function triggerBubbleFlash(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const box = target.closest(".filebox");
  const path = box?.querySelector<HTMLElement>(".fname")?.dataset.path;
  const isNodeOrLabelClick = target.closest(".node, .nlabel") !== null;
  const ignoresClick = box === null || path === undefined || isNodeOrLabelClick;
  if (ignoresClick) {
    return;
  }
  const touched: WireSession[] = [];
  for (const session of listVisibleSessions()) {
    const touchesPath = listSessionPathsInProject(session).includes(path);
    if (touchesPath) {
      touched.push(session);
    }
  }
  if (touched.length === 0) {
    return;
  }
  const instant = readInstantNearestClick(box, event.clientY);
  function compareSessionGaps(a: WireSession, b: WireSession): number {
    return measureSessionGap(a, instant) - measureSessionGap(b, instant);
  }
  touched.sort(compareSessionGaps);
  const files: string[] = [];
  for (const session of touched) {
    files.push(session.file);
  }
  addSessionFlash(...files);
}

function registerBubbleFlash(): void {
  getRequiredElementById("stage").addEventListener("click", triggerBubbleFlash);
}

export { addSessionFlash as flashSession, registerBubbleFlash as wireBubbleFlash };
