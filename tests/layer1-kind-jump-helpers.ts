// Shared setup and helpers for the kind-jump arrow tests.

import { createElement, getInputById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
export const { refreshKindJumpArrows } = await import("../webapp/layer1-kind-jump.ts");

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };
const PAIR = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, snapshots: [SNAPSHOT] };
const VIEW = { pairs: [PAIR], gitOrphans: [], diskOrphans: [], ruler: [] } as never;

export const PANE_HEIGHT_PX = 300;
const NODE_HEIGHT_PX = 10;

// The pane's scroll offset in content pixels; a node's on-screen box is its content y minus this.
function readViewTopPx(): number {
  return document.getElementById("timelines")!.scrollTop;
}

export function buildNode(className: string, centerY: number): HTMLElement {
  const node = createElement("i", { class: `node ${className}`, "data-y": String(centerY) });
  Object.assign(node, {
    getBoundingClientRect: () => {
      const top = centerY - readViewTopPx() - NODE_HEIGHT_PX / 2;
      return { top, bottom: top + NODE_HEIGHT_PX, left: 100, right: 110, height: NODE_HEIGHT_PX };
    },
  });
  return node;
}

export async function renderViewWithSyntheticStage(): Promise<void> {
  initLayer1Dom();
  getInputById("dir").value = "";
  await renderLayer1View(VIEW);
  Object.assign(document.getElementById("timelines")!, {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: PANE_HEIGHT_PX, left: 0, right: 1000, height: PANE_HEIGHT_PX }),
  });
  document.getElementById("stage")!.replaceChildren(
    buildNode("n-commit", 100), buildNode("n-commit", 400), buildNode("n-commit", 700),
    buildNode("n-snap", 50), buildNode("n-snap", 550),
  );
  refreshKindJumpArrows();
}

export function findArrow(kind: string, direction: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`#show-row [data-jump-kind=${kind}][data-jump=${direction}]`)!;
}

export function readLandedY(): string {
  return document.querySelector<HTMLElement>("#stage .found")!.dataset["y"]!;
}
