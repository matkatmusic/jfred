// Clicking a session dot opens the Details drawer on that dot's JSON line.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { getBasename, renderDetailView } from "../details-drawer/layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "../details-drawer/layer1-drawer-diff.ts";
import { fetchRawJsonLine } from "../details-drawer/layer1-drawer-node-detail.ts";
import { openDetailsPane } from "../details-drawer/layer1-details-pane.ts";

// Label on the first line; the log file's base name and line number under it.
function buildDotMetaText(dot: HTMLElement): string {
  const fileName = getBasename(dot.dataset["sessionFile"]!);
  return `${dot.dataset["recordLabel"]!}\n${fileName} line ${dot.dataset["line"]!}`;
}

function openDrawerHeading(dot: HTMLElement): void {
  for (const id of ["dprev", "dnext"] as const) {
    getRequiredElementById(id).hidden = true;
  }
  getRequiredElementById("dpath").textContent = dot.dataset["sessionTitle"]!;
  getRequiredElementById("dpath").title = dot.dataset["sessionFile"]!;
  // getRequiredElementById("dmeta").textContent = dot.dataset["recordLabel"]!;
  getRequiredElementById("dmeta").textContent = buildDotMetaText(dot);
  // getRequiredElementById("detailsPaneContainer").classList.add("open");
  openDetailsPane();
  setDrawerTools("none");
}

async function openAnnotationDrawer(dot: HTMLElement): Promise<void> {
  clearDiffPair();
  openDrawerHeading(dot);
  const json = await fetchRawJsonLine(dot.dataset["sessionFile"]!, Number(dot.dataset["line"]));
  renderDetailView([createElement("div", { class: "node-json", "data-component": "sessionDotsJsonText" }, [json])]);
}

function openDrawerOnDotClick(event: MouseEvent): void {
  const dot = (event.target as HTMLElement).closest<HTMLElement>("i.anode");
  if (dot === null) {
    return;
  }
  void openAnnotationDrawer(dot);
}

// Delegated on the document: the track is redrawn, so dots cannot hold the listener.
export function installAnnotationClick(): void {
  document.addEventListener("click", openDrawerOnDotClick);
}
