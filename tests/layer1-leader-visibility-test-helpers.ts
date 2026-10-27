import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

interface FixtureInstant {
  instant: string;
  axisPx: number;
}

// SHARED_PX: the second bubble begins there and the first holds an interior node there.
export const EARLY_PX = 10;
export const SHARED_PX = 40;
export const LATE_PX = 110;

export const AT_EARLY: FixtureInstant = { instant: "2026-06-01T09:00:00.000Z", axisPx: EARLY_PX };
export const AT_SHARED: FixtureInstant = { instant: "2026-06-04T09:00:00.000Z", axisPx: SHARED_PX };
const AT_LATE: FixtureInstant = { instant: "2026-06-11T09:00:00.000Z", axisPx: LATE_PX };

// Real 40-character hashes: a 7-character fake would hide a broken label truncation.
export const EARLY_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHARED_HASH = "e4f5a6b7c8d90e1f2a3b4c5d6e7f8091a2b3c4d5";

// Begins EARLY and holds an interior node on the shared instant.
const SPANNING_PAIR = {
  path: "src/spanning.ts",
  commits: [{ ...AT_EARLY, hash: EARLY_HASH }, { ...AT_SHARED, hash: SHARED_HASH }],
  onDisk: AT_LATE,
};

// Begins ON the shared instant.
const BEGINNING_PAIR = {
  path: "src/beginning.ts",
  commits: [{ ...AT_SHARED, hash: SHARED_HASH }],
  onDisk: AT_LATE,
};

export function buildSharedInstantView(): object {
  return {
    pairs: [SPANNING_PAIR, BEGINNING_PAIR],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [
      { ...AT_EARLY, eventCount: 1 },
      { ...AT_SHARED, eventCount: 2 },
      { ...AT_LATE, eventCount: 2 },
    ],
  };
}

export async function loadPageWithView(view: object): Promise<void> {
  initLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
  stubStreamRoute("/api/layer1-view", [view]);
  const { initLayer1Page } = await import("../webapp/layer1-page.ts");
  initLayer1Page();
  await waitForAsyncWork();
}

// The offsets of the lines currently DRAWN, which is the whole assertion surface here.
export function listShownLeaderOffsets(): number[] {
  const offsets: number[] = [];
  for (const leader of document.querySelectorAll<HTMLElement>("#leaders .leader.shown")) {
    offsets.push(Number(leader.style.getPropertyValue("--axis-px")));
  }
  return offsets;
}

export function findBubble(basename: string): HTMLElement {
  let bubble: HTMLElement | undefined;
  for (const name of document.querySelectorAll<HTMLElement>("#stage .filebox .fname")) {
    const isNamedBasename = name.textContent === basename;
    if (isNamedBasename) {
      bubble = name.closest(".filebox") as HTMLElement;
      break;
    }
  }
  assert.ok(bubble, `no bubble named ${basename} was drawn`);
  return bubble;
}

export function findTickAt(axisPx: number): HTMLElement {
  let found: HTMLElement | undefined;
  for (const tick of document.querySelectorAll<HTMLElement>("#ruler .tick")) {
    const isAtAxisPx = tick.style.getPropertyValue("--axis-px") === String(axisPx);
    if (isAtAxisPx) {
      found = tick;
      break;
    }
  }
  assert.ok(found, `no ruler tick was drawn at ${axisPx}px`);
  return found;
}

// Drive hover through a bubbling event, because the listener is wired to the PANE: this proves wiring and lookup.
export function triggerHover(element: Element | undefined): void {
  if (element === undefined) {
    document.getElementById("timelines")?.dispatchEvent(new window.Event("pointerleave"));
    return;
  }
  element.dispatchEvent(new window.Event("pointerover", { bubbles: true }));
}
