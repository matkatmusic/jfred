// Clicking a session dot opens the Details drawer on that dot's JSON line.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { renderDetailView } from "../details-drawer/layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "../details-drawer/layer1-drawer-diff.ts";
import { fetchRawJsonLine } from "../details-drawer/layer1-drawer-node-detail.ts";

function openDrawerHeading(dot: HTMLElement): void {
  for (const id of ["dprev", "dnext"] as const) {
    getRequiredElementById(id).hidden = true;
  }
  getRequiredElementById("dpath").textContent = dot.dataset["sessionTitle"]!;
  getRequiredElementById("dmeta").textContent = dot.dataset["recordLabel"]!;
  getRequiredElementById("drawer").classList.add("open");
  setDrawerTools("none");
}

async function openAnnotationDrawer(dot: HTMLElement): Promise<void> {
  clearDiffPair();
  openDrawerHeading(dot);
  const json = await fetchRawJsonLine(dot.dataset["sessionFile"]!, Number(dot.dataset["line"]));
  renderDetailView([createElement("div", { class: "node-json" }, [json])]);
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
