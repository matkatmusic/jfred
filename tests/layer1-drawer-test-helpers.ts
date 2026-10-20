// Shared setup for the layer1-drawer-*.test.ts files: fetch and animation stubs, pane readers, and stage builders.

import { el, getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView, rememberNavTargets } from "../webapp/layer1-diff-wash.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

export const DISK_FILE_PATH = "src/demo.ts";
export const DISK_FILE_CONTENT = "const x = 1;\nconst y = 2;\n";
export const COMMIT_CONTENT = "const x = 1;\n";
export const FULL_DIFF = "@@ -1,2 +1,2 @@\n const x = 1;\n const y = 2;";

export const LANE_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const MIDDLE_HASH = "b2c3d4e5f60718293a4b5c6d7e8f9012345678aa";
export const LANE_T0 = "2026-07-01T10:00:00.000Z";
export const LANE_T1 = "2026-07-01T11:00:00.000Z";
export const LANE_T2 = "2026-07-01T12:00:00.000Z";

// happy-dom has no animation clock, so the deferred re-centre callback runs inline; it must merely not throw.
export function installAnimationFrameStub(): void {
  Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  } });
}

// Records every ask; content GETs answer via `contentFor`, the diff POST answers FULL_DIFF.
export function installRecordingFetch(contentFor: (params: URLSearchParams) => object): { url: string; body?: string }[] {
  const asks: { url: string; body?: string }[] = [];
  Object.assign(globalThis, {
    fetch: async (url: unknown, init?: { body?: string }): Promise<Response> => {
      asks.push({ url: String(url), body: init?.body });
      const isDiffAsk = String(url).includes("layer1-diff-content");
      const query = String(url).slice(String(url).indexOf("?") + 1);
      const payload = isDiffAsk ? { diff: FULL_DIFF } : contentFor(new URLSearchParams(query));
      return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
    },
  });
  return asks;
}

// The awaited chain is loadContent -> diff POST -> render; two drained turns cover it.
export async function waitForPendingFetches(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function getFirstPane(): HTMLElement {
  return getRequiredElementById("dbody").querySelector("details.dfile") as HTMLElement;
}

export function listPaneArrows(): HTMLButtonElement[] {
  return [...getFirstPane().querySelectorAll("summary .dtools button")] as HTMLButtonElement[];
}

// One bubble with a single on-disk node: reads the working tree, so no commit hash needed.
export function buildDiskNodeStage(): HTMLElement {
  const node = el("i", { class: "node n-disk" });
  getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
    el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
    el("div", { class: "lane" }, [node, el("span", { class: "nlabel", text: "on disk" })]),
  ]));
  return node;
}

// A lane holding commit node(s) and the on-disk node, axis-placed oldest to newest.
export function buildLaneStage(withMiddle: boolean): { commitNode: HTMLElement; middleNode: HTMLElement; diskNode: HTMLElement } {
  const commitNode = el("i", { class: "node n-commit", title: LANE_HASH });
  commitNode.style.setProperty("--axis-px", "10");
  const middleNode = el("i", { class: "node n-commit", title: MIDDLE_HASH });
  middleNode.style.setProperty("--axis-px", "25");
  const diskNode = el("i", { class: "node n-disk" });
  diskNode.style.setProperty("--axis-px", "40");
  const laneNodes = withMiddle ? [commitNode, middleNode, diskNode] : [commitNode, diskNode];
  getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
    el("div", { class: "fname", text: "demo.ts", "data-path": DISK_FILE_PATH }),
    el("div", { class: "lane" }, laneNodes),
  ]));
  return { commitNode, middleNode, diskNode };
}

// Task 329: the shift-click gesture reads instants off the DRAWN view, so tests arm the memo the page keeps.
export function applyLaneView(withMiddle: boolean): void {
  const middleTicks = withMiddle ? [{ instant: LANE_T1, axisPx: 25, eventCount: 1 }] : [];
  const middleCommits = withMiddle ? [{ hash: MIDDLE_HASH, instant: LANE_T1, axisPx: 25 }] : [];
  rememberDrawnView({
    pairs: [{
      path: DISK_FILE_PATH,
      commits: [{ hash: LANE_HASH, instant: LANE_T0, axisPx: 10 }, ...middleCommits],
      onDisk: { instant: LANE_T2, axisPx: 40 },
    }],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [{ instant: LANE_T0, axisPx: 10, eventCount: 1 }, ...middleTicks, { instant: LANE_T2, axisPx: 40, eventCount: 1 }],
  } as WireLayer1View);
  rememberNavTargets([]);
}
