// Task 329: the base/target instant wash — two shift-clicked nodes become one global range.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { resolveAxisPixelsAt } from "./layer1-ranges.ts";
import { spawnWash } from "./layer1-wash.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import type { WireLayer1View, WireRulerTick } from "./layer1-wire.ts";

// The view the stage last DREW (post-filter), because the wash and the steps must match the drawn axis.
let drawnView: WireLayer1View | undefined;
// The File Nav selection; the wash diffs these files plus the two clicked ones.
let navTargets: string[] = [];

function setDrawnView(view: WireLayer1View): void {
  drawnView = view;
}

function setNavTargets(targets: string[]): void {
  navTargets = targets;
}

export function readDrawnView(): WireLayer1View | undefined {
  return drawnView;
}

export function readNavTargets(): string[] {
  return navTargets;
}

// A node's instant always owns a ruler tick; a merged or re-laid row falls back to interpolation.
function findAxisPixelsForInstant(instant: string, ruler: readonly WireRulerTick[]): number {
  for (const tick of ruler) {
    if (tick.instant === instant) {
      return tick.axisPx;
    }
  }
  return resolveAxisPixelsAt(Date.parse(instant), ruler);
}

// The last range painted, so a stage re-render (which wipes #washes wholesale) can repaint it.
let diffWashRange: { baseInstant: string; targetInstant: string } | undefined;

export function clearDiffWash(): void {
  diffWashRange = undefined;
  for (const wash of document.querySelectorAll(".diff-wash, .wash-edge")) {
    wash.remove();
  }
}

function readTickDistance(tick: HTMLElement, axisPx: number): number {
  return Math.abs(Number(tick.style.getPropertyValue("--axis-px")) - axisPx);
}

function findNearestTick(axisPx: number): HTMLElement | undefined {
  const ticks = getRequiredElementById("ruler").querySelectorAll<HTMLElement>(".tick");
  let nearest: HTMLElement | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const tick of ticks) {
    const distance = readTickDistance(tick, axisPx);
    if (distance < nearestDistance) {
      nearest = tick;
      nearestDistance = distance;
    }
  }
  return nearest;
}

// The gutter names the wash's edges (user feedback, 2026-07-30): the ruler row nearest each boundary.
function appendWashEdgeLabel(axisPx: number, edge: "base" | "target"): void {
  findNearestTick(axisPx)?.append(createElement("div", { class: `wash-edge ${edge}`, text: `selected diff range ${edge}` }));
}

function renderDiffWash(baseInstant: string, targetInstant: string, ruler: readonly WireRulerTick[]): void {
  const baseAxisPx = findAxisPixelsForInstant(baseInstant, ruler);
  const targetAxisPx = findAxisPixelsForInstant(targetInstant, ruler);
  const wash = spawnWash(baseAxisPx - RULER_NODE_ROW_PIXELS / 2, targetAxisPx + RULER_NODE_ROW_PIXELS / 2, "var(--sel-edge)");
  wash.classList.add("diff-wash");
  getRequiredElementById("washes").append(wash);
  appendWashEdgeLabel(baseAxisPx, "base");
  appendWashEdgeLabel(targetAxisPx, "target");
}

// Half a row clear of both boundary nodes, exactly as the session wash closes on its covered events.
function applyDiffWash(baseInstant: string, targetInstant: string, ruler: readonly WireRulerTick[]): void {
  clearDiffWash();
  diffWashRange = { baseInstant, targetInstant };
  renderDiffWash(baseInstant, targetInstant, ruler);
}

// Every stage render replaces #washes wholesale; repaint the remembered range so it survives.
function renderRememberedDiffWash(ruler: readonly WireRulerTick[]): void {
  if (diffWashRange !== undefined) {
    renderDiffWash(diffWashRange.baseInstant, diffWashRange.targetInstant, ruler);
  }
}

export {
  setDrawnView as rememberDrawnView,
  setNavTargets as rememberNavTargets,
  findAxisPixelsForInstant as axisPixelsForInstant,
  applyDiffWash as paintDiffWash,
  renderRememberedDiffWash as repaintDiffWash,
};
