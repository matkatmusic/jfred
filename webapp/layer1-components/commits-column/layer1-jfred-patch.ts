// Task 603: the patch of a shown jfred commit, written under its message in the Details drawer.

import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { buildJfredMessageTitle } from "./layer1-jfred-drawer.ts";

async function fetchJfredCommitPatch(shortHash: string): Promise<string> {
  const query = new URLSearchParams(location.search);
  query.set("hash", shortHash);
  const response = await fetch(`/api/layer1-jfred-patch?${query}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}

export async function appendJfredPatch(shortHash: string): Promise<void> {
  const patchText = await fetchJfredCommitPatch(shortHash);
  const isStillShown = getRequiredElementById("dpath").textContent === buildJfredMessageTitle(shortHash);
  if (isStillShown) {
    const pane = getRequiredElementById("dbody").querySelector(".jpane")!;
    pane.append(createElement("pre", { class: "jfred-patch", "data-component": "commitsPatchText", text: patchText }));
  }
}
