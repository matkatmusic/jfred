// Shared fixtures for the script-run drawer tests: one run touching two files, and a one-run drawer opener.

import { createElement,getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView, rememberNavTargets } from "../webapp/layer1-diff-wash.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
  DISK_FILE_CONTENT, LANE_T0, LANE_T2, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

export const SCRIPT_TOOL_USE_ID = "toolu_ren_1";
export const SCRIPT_RUN: WireScriptRun = {
  instant: LANE_T0, axisPx: 0, toolUseId: SCRIPT_TOOL_USE_ID,
  executorKind: "python", language: "python", line: 83, code: 'open("rename_inv.py").read()', label: "rename_inv.py",
  sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl",
};

export function armScriptRunView(): void {
  rememberDrawnView({
    pairs: [
      { path: "src/a.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 }, scriptRuns: [SCRIPT_RUN] },
      { path: "src/b.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 }, scriptRuns: [SCRIPT_RUN] },
    ],
    gitOrphans: [], diskOrphans: [],
    ruler: [{ instant: LANE_T0, axisPx: 0, eventCount: 1 }, { instant: LANE_T2, axisPx: 40, eventCount: 1 }],
  } as WireLayer1View);
  rememberNavTargets([]);
}

export function buildScriptRunStage(): { nodeA: HTMLElement; nodeB: HTMLElement; connector: HTMLElement } {
  const nodeA = createElement("i", { class: "node n-script", "data-tool-use-id": SCRIPT_TOOL_USE_ID });
  const nodeB = createElement("i", { class: "node n-script", "data-tool-use-id": SCRIPT_TOOL_USE_ID });
  const connector = createElement("div", { class: "script-connector", "data-tool-use-id": SCRIPT_TOOL_USE_ID });
  getRequiredElementById("stage").replaceChildren(
    createElement("div", { class: "filebox" }, [
      createElement("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
      createElement("div", { class: "lane" }, [nodeA]),
    ]),
    connector,
    createElement("div", { class: "filebox" }, [
      createElement("div", { class: "fname", text: "b.ts", "data-path": "src/b.ts" }),
      createElement("div", { class: "lane" }, [nodeB]),
    ]),
  );
  return { nodeA, nodeB, connector };
}

// Opens the drawer on the two-file SCRIPT_RUN by clicking its first node.
export async function openScriptRunDrawerByClick(): Promise<void> {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  const { nodeA } = buildScriptRunStage();
  armScriptRunView();
  installNodeDrawer();
  nodeA.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();
}

// Opens the drawer on one run touching src/a.ts and returns the drawer body.
export async function openSingleRunDrawer(run: WireScriptRun): Promise<HTMLElement> {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  rememberDrawnView({
    pairs: [{ path: "src/a.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 }, scriptRuns: [run] }],
    gitOrphans: [], diskOrphans: [],
    ruler: [{ instant: LANE_T2, axisPx: 40, eventCount: 1 }],
  } as WireLayer1View);
  rememberNavTargets([]);
  const node = createElement("i", { class: "node n-script", "data-tool-use-id": run.toolUseId });
  getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
    createElement("div", { class: "fname", text: "a.ts", "data-path": "src/a.ts" }),
    createElement("div", { class: "lane" }, [node]),
  ]));
  installNodeDrawer();
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();
  return getRequiredElementById("dbody");
}
