// Draws the Layer 1 stage: ruler ticks, leader lines, pairs and orphans, in chunks.

import { el, getRequiredElementById } from "./app-dom.ts";
import { rememberDrawnView, readNavTargets, repaintDiffWash } from "./layer1-diff-wash.ts";
import { makeLeaderHoverable } from "./layer1-leader-hover.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { renderNavWash } from "./layer1-nav-wash.ts";
import { LAYER1_PROGRESS_LABEL_DRAWING_RULER, LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE, hideLayer1Progress, showLayer1Progress, waitForPaintedFrame } from "./layer1-progress.ts";
import { refreshKindJumpArrows } from "./layer1-kind-jump.ts";
import { renderSessionRanges } from "./layer1-ranges.ts";
import { makeRulerTickClickable } from "./layer1-ruler-click.ts";
import { listRulerRows } from "./layer1-ruler-rows.ts";
import { drawScriptConnectors } from "./layer1-script-connectors.ts";
import { listSelectedSessions } from "./layer1-sessions.ts";
import { carryOpenRowToNewTicks, markMultiEventTicks } from "./layer1-tick-files.ts";
import { buildOrphanBucket, buildStagePairs, setAxisPx } from "./layer1-widgets.ts";
import type { WireInstant, WireLayer1View, WireRulerTick } from "./layer1-wire.ts";

// Builds elements only; layer1-ruler-rows.ts decides which entries print and what each row reads.
function renderRulerTicks(ruler: WireRulerTick[]): void {
  // A row carries every offset it ABSORBED, since a merged row's click must see all their events.
  const ticks: HTMLElement[] = [];
  for (const row of listRulerRows(ruler)) {
    ticks.push(makeRulerTickClickable(setAxisPx(el("div", { class: "tick", text: row.text }), row.axisPx), row));
  }
  getRequiredElementById("ruler").replaceChildren(el("div", { class: "rail" }), ...ticks);
}

// One shared line per ruler entry, replacing the slow per-bubble `.filebox::before`.
function renderLeaderLines(ruler: WireInstant[]): void {
  const leaders: HTMLElement[] = [];
  for (const entry of ruler) {
    leaders.push(makeLeaderHoverable(setAxisPx(el("div", { class: "leader" }), entry.axisPx)));
  }
  getRequiredElementById("leaders").replaceChildren(...leaders);
}

// Task 309: chunked appends with painted counts, so a big render never reads as a hang.
const STAGE_CHUNK_WIDGETS = 100;

// Bumped by every render so a superseded chunked pass stops instead of interleaving DOM writes.
let stageRenderPass = 0;

// Exported for filter redraws; a single-chunk (test-sized) view completes synchronously, no await runs.
export async function renderLayer1Stage(view: WireLayer1View): Promise<void> {
  // The wash and range steps read the DRAWN view, so every filter/expansion redraw re-arms it.
  rememberDrawnView(view);
  const pass = ++stageRenderPass;
  getRequiredElementById("crumb").textContent =
    `${view.pairs.length} pairs · ${view.gitOrphans.length} repo-only · ${view.diskOrphans.length} disk-only`;
  const openList = document.querySelector("#ruler .tickfiles");
  renderRulerTicks(view.ruler);
  carryOpenRowToNewTicks(openList);
  renderLeaderLines(view.ruler);
  const widgets = buildStagePairs(view.pairs);
  for (const bucket of [buildOrphanBucket("No on-disk match", view.gitOrphans), buildOrphanBucket("No repository match", view.diskOrphans)]) {
    if (bucket !== undefined) {
      widgets.push(bucket);
    }
  }
  const stage = getRequiredElementById("stage");
  stage.replaceChildren();
  // Only a multi-chunk render paints between chunks; a small one must never flash the loadbar.
  const isChunked = widgets.length > STAGE_CHUNK_WIDGETS;
  for (let done = 0; done < widgets.length; done += STAGE_CHUNK_WIDGETS) {
    stage.append(...widgets.slice(done, done + STAGE_CHUNK_WIDGETS));
    if (!isChunked) {
      continue;
    }
    showLayer1Progress(LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE,
      Math.min(done + STAGE_CHUNK_WIDGETS, widgets.length), widgets.length);
    await waitForPaintedFrame();
    if (pass !== stageRenderPass) {
      return;
    }
  }
  if (isChunked) {
    showLayer1Progress(LAYER1_PROGRESS_LABEL_DRAWING_RULER);
    await waitForPaintedFrame();
    if (pass !== stageRenderPass) {
      return;
    }
  }
  // These three MEASURE the drawn stage, so they must run after the bubbles are in the DOM.
  markMultiEventTicks();
  refreshKindJumpArrows();
  // renderSessionRanges replaces #washes wholesale, so the surviving wash kinds repaint AFTER it, every render.
  renderSessionRanges(listSelectedSessions(), view.ruler);
  renderNavWash(view, readNavTargets());
  repaintDiffWash(view.ruler);
  drawLayer1Minimap();
  drawScriptConnectors(stage);
  if (isChunked) {
    hideLayer1Progress();
  }
}
