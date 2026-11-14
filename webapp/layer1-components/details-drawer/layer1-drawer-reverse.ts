// A reverse node's drawer: that file state diffed against the next older state, both sides read from the stored walk.

import { getRequiredElementById } from "../../app-dom.ts";
import { readReverseState, readReverseWalk } from "../../layer1-reverse-store.ts";
import { WireReverseKind, type WireReverseState } from "../../layer1-wire-reverse.ts";
import { markLandedElement } from "../top-bars/layer1-find-file.ts";
import { readNodeIdentity, storeOpenedNode } from "../bubbles/layer1-node-link.ts";
import { getShortCommitHash } from "../bubbles/layer1-reverse-bubble.ts";
import { DiffPaneMode, type DiffStep } from "./layer1-diff-pane.ts";
import { buildDiffView, renderDetailView } from "./layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "./layer1-drawer-diff.ts";
import { appendRawJsonRevealForLine } from "./layer1-drawer-node-detail.ts";
import { openDetailsPane } from "./layer1-details-pane.ts";

const KIND_WORDS: Record<WireReverseKind, string> = {
  [WireReverseKind.DiskNow]: "on disk now",
  [WireReverseKind.EditUndone]: "before edit",
  [WireReverseKind.WriteUndone]: "before write",
  [WireReverseKind.FileCreated]: "file did not exist",
  [WireReverseKind.UnknownChange]: "unknown change",
  [WireReverseKind.ScriptChange]: "script change",
  [WireReverseKind.GitCommit]: "commit",
  [WireReverseKind.BackupSnapshot]: "snapshot",
  [WireReverseKind.ReadOnly]: "read, no change",
  [WireReverseKind.PossibleChange]: "possible change, bytes not known",
};

function formatKindWords(state: WireReverseState): string {
  if (state.kind === WireReverseKind.GitCommit) {
    return `${KIND_WORDS[state.kind]} ${getShortCommitHash(state)}`;
  }
  return KIND_WORDS[state.kind];
}

// The content is already on the page, so the step fetches nothing; only the file path is left to name.
function createWalkStep(path: string, index: number, state: WireReverseState | undefined): DiffStep {
  return {
    marker: `state ${index + 1}`,
    buildParams: () => new URLSearchParams({ path }),
    loadContent: async () => state?.content ?? "",
  };
}

export function openReverseNodeDrawer(node: HTMLElement, path: string): void {
  const index = Number(node.dataset.index);
  const state = readReverseState(path, index);
  if (state === undefined) {
    throw new Error(`no reverse state ${index} stored for ${path}`);
  }
  const stateCount = readReverseWalk(path)!.states.length;
  clearDiffPair();
  storeOpenedNode(readNodeIdentity(node));
  for (const id of ["dprev", "dnext"] as const) {
    getRequiredElementById(id).hidden = true;
  }
  const header = getRequiredElementById("dpath");
  header.textContent = path;
  header.title = path;
  getRequiredElementById("dmeta").textContent = `state ${index + 1} of ${stateCount} · ${formatKindWords(state)} · ${state.instant ?? "now"}`;
  markLandedElement(node);
  // getRequiredElementById("detailsPaneContainer").classList.add("open");
  openDetailsPane();
  setDrawerTools("none");
  const steps = [createWalkStep(path, index + 1, readReverseState(path, index + 1)), createWalkStep(path, index, state)];
  renderDetailView([buildDiffView(path, steps, {
    revisionControlsShown: true,
    mode: DiffPaneMode.inline,
    fullContents: false,
    baseIndex: 0,
    targetIndex: 1,
  })]);
  const { sessionFile, line } = node.dataset;
  const hasSessionFile = sessionFile !== undefined;
  const hasLine = line !== undefined;
  const hasRevealTarget = hasSessionFile && hasLine;
  if (hasRevealTarget) {
    appendRawJsonRevealForLine(sessionFile, Number(line));
  }
}
