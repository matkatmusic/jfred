// Pure judges and fact types for the ruler UI Commit mode and hide-ignored checks.

import { JfredEntryKind } from "../../webapp/layer1-components/commits-column/layer1-jfred-entries.ts";
import { isNear } from "./layer7-facts.ts";
import { FIXTURE_BASE_HASH, type DrawerFacts } from "./layer9-probes.ts";
import { EDGE_PX, LEVEL_PX } from "./ruler-ui-checks.ts";
import { type Box, type HoverFacts } from "./ruler-ui-probes.ts";
import { type LineFacts } from "./ruler-ui-session-checks.ts";

export interface StripFacts {
  strip: Box; rulerRight: number; stageLeft: number; headText: string; deleteCount: number; chains: number; isCovering: boolean;
  entries: { kind: string; shortHash: string | undefined; cx: number; cy: number; tickCy: number }[];
  lines: (Box & { style: string; nodeCx: number })[]; marks: Record<string, number>; untitledNo: number;
}
export interface BothFacts { strip: Box; track: Box; stageLeft: number; trackZ: number; stripZ: number; isEveryLineCrossing: boolean; overlaps: number; crossings: number; isEveryDotOnTop: boolean }
export interface IgnoredDot { display: string; opacity: number; cy: number }
export interface IgnoredState { dots: IgnoredDot[]; line: LineFacts }
const STRIP_WIDTH_PX = 104;
const MAX_STRIP_WIDTH_PX = 120;
const MESSAGE_COLUMNS = 50;
const IGNORED_OPACITY = 0.38;
export const COMMIT_HASHES = ["c0ffee01", "c0ffee02"];
const isShortLine = (line: string) => line.length <= MESSAGE_COLUMNS;
const isHiddenDot = (dot: IgnoredDot) => dot.display === "none";

// Ticked: both ignored dots are display none and the line is unchanged. Unticked: they show dimmed inside it.
export function isIgnoredToggleRight(hidden: IgnoredState, shown: IgnoredState): boolean {
  const isShownDot = (dot: IgnoredDot) => dot.display !== "none" && isNear(dot.opacity, IGNORED_OPACITY, 0.01) && dot.cy >= shown.line.top && dot.cy <= shown.line.bottom;
  const isLineKept = isNear(hidden.line.top, shown.line.top, EDGE_PX) && isNear(hidden.line.bottom, shown.line.bottom, EDGE_PX) && shown.line.bottom > shown.line.top;
  let isDotsRight = hidden.dots.length === 2 && shown.dots.length === 2;
  for (const dot of hidden.dots)
    isDotsRight &&= isHiddenDot(dot);
  for (const dot of shown.dots)
    isDotsRight &&= isShownDot(dot);
  return isDotsRight && isLineKept;
}

export const isCommitOff = (f: { stripCount: number; cutTicks: number }) => f.stripCount === 0 && f.cutTicks === 0;
export const isStripHeadRight = (f: StripFacts) => f.headText.includes("commits") && f.deleteCount === 1;
export const isNoPopup = (h: HoverFacts) => !h.isVisible;
export const isDrawerRight = (d: DrawerFacts) => d.isOpen && d.text.includes("jfred: reconstruct to");
export function isStripPlaced(f: StripFacts, offStageLeft: number): boolean {
  const width = f.strip.right - f.strip.left;
  const isWidthRight = isNear(width, STRIP_WIDTH_PX, EDGE_PX) && width < MAX_STRIP_WIDTH_PX;
  return isWidthRight && isNear(f.strip.left, f.rulerRight, EDGE_PX) && isNear(f.stageLeft, offStageLeft, EDGE_PX) && f.isCovering;
}
export function isEntryColumnRight(f: StripFacts): boolean {
  const [base, first, second] = f.entries;
  const isShape = f.entries.length === 3 && base!.kind === JfredEntryKind.base && base!.shortHash === FIXTURE_BASE_HASH && f.chains === 2;
  let isRight = isShape && first!.shortHash === COMMIT_HASHES[0] && second!.shortHash === COMMIT_HASHES[1];
  for (const entry of f.entries) {
    isRight &&= isNear(entry.cy, entry.tickCy, LEVEL_PX) && isNear(entry.cx, base!.cx, LEVEL_PX);
  }
  return isRight;
}
export function isEveryLineRight(f: StripFacts): boolean {
  let isRight = f.lines.length === 3;
  for (const line of f.lines) {
    isRight &&= line.style === "dashed" && isNear(line.left, f.rulerRight, LEVEL_PX) && isNear(line.right, line.nodeCx, LEVEL_PX);
  }
  return isRight;
}
export const isEveryMarkRight = (f: StripFacts) =>
  f.marks["cut-base"] === 1 && f.marks["cut-set"] === 2 && f.marks["cut-ok"]! > 0 && f.marks["cut-no"]! > 0 && f.untitledNo === 0;
export function isCommitPopupRight(h: HoverFacts): boolean {
  const isMessage = h.lines[0]?.startsWith("jfred: reconstruct to") === true && h.lines.includes("includes 4 unmarked changes");
  let isEveryLineShort = true;
  for (const line of h.lines)
    isEveryLineShort &&= isShortLine(line);
  return h.isVisible && isMessage && isEveryLineShort && h.isHiddenAfter;
}
export function isBothRight(f: BothFacts, offStageLeft: number): boolean {
  const trackWidth = f.track.right - f.track.left;
  const isShifted = isNear(f.stageLeft, offStageLeft + trackWidth, EDGE_PX) && !isNear(f.stageLeft, offStageLeft + f.strip.right - f.strip.left, EDGE_PX);
  const isCrossing = f.isEveryLineCrossing && f.crossings > 0 && f.isEveryDotOnTop;
  return isShifted && isCrossing && isNear(f.strip.left, f.track.right, EDGE_PX) && f.trackZ > f.stripZ && f.overlaps === 0;
}
